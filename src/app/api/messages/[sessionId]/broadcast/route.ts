import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { sanitizePhoneToJid } from "@/lib/jid-utils";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { z } from "zod";

export const normalizeBroadcastJid = sanitizePhoneToJid;

const broadcastBodySchema = z.object({
    recipients: z.array(z.string()),
    message: z.string().min(1),
    delay: z.number().min(500).max(300_000).optional(),
    // CNP: envio em blocos — manda por `pauseAfterMinutes` e para por `pauseMinutes` (os dois ou nenhum)
    pauseAfterMinutes: z.number().int().min(1).max(1440).optional(),
    pauseMinutes: z.number().int().min(1).max(1440).optional()
}).refine((b) => (b.pauseAfterMinutes === undefined) === (b.pauseMinutes === undefined), {
    message: "pauseAfterMinutes e pauseMinutes vão juntos",
    path: ["pauseMinutes"]
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Socket atual da sessão; se caiu, espera reconectar (até 2 min) em vez de falhar o resto da lista. */
async function socketFor(sessionId: string) {
    for (let i = 0; i < 24; i++) {
        const inst = waManager.getInstance(sessionId);
        if (inst?.socket && inst.status === "CONNECTED") return inst.socket;
        await sleep(5000);
    }
    throw new Error("Session not connected");
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const body = await request.json();

        const parseResult = broadcastBodySchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ error: parseResult.error.flatten() }, { status: 400 });
        }

        const { recipients, message, delay, pauseAfterMinutes, pauseMinutes } = parseResult.data;

        // Sanitize & normalize recipients (strip '+', whitespace, non-digits, ensure valid WhatsApp JID format)
        const normalizedRecipients = Array.from(
            new Set(recipients.map(normalizeBroadcastJid).filter((j): j is string => Boolean(j)))
        );

        if (normalizedRecipients.length === 0) {
            return NextResponse.json(
                { status: false, message: "No valid recipient JIDs provided", error: "No valid recipient JIDs" },
                { status: 400 }
            );
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // --- Save BroadcastLog & recipients to DB ---
        const log = await prisma.broadcastLog.create({
            data: {
                sessionId,
                message,
                total: normalizedRecipients.length,
                delay: delay || 2000,
                pauseAfterMinutes: pauseAfterMinutes ?? null,
                pauseMinutes: pauseMinutes ?? null,
                status: "running",
                recipients: {
                    create: normalizedRecipients.map(jid => ({
                        jid,
                        status: "pending"
                    }))
                }
            },
            include: { recipients: true }
        });

        const messageContent: AnyMessageContent = { text: message };
        const io = (global as any).io;
        const broadcastId = log.id;

        // Emit initial state
        if (io) {
            io.to(sessionId).emit("broadcast.progress", {
                broadcastId,
                status: "running",
                total: normalizedRecipients.length,
                sent: 0,
                failed: 0,
                current: null,
                progress: 0,
                startedAt: log.startedAt.toISOString()
            });
        }

        // Process in background — update DB as we go
        (async () => {
            let sent = 0;
            let failed = 0;
            const errors: { jid: string; error: string }[] = [];
            const blockMs = pauseAfterMinutes ? pauseAfterMinutes * 60_000 : 0;
            const pauseMs = pauseMinutes ? pauseMinutes * 60_000 : 0;
            let blockStart = Date.now();

            for (let i = 0; i < normalizedRecipients.length; i++) {
                const jid = normalizedRecipients[i];
                try {
                    // socket buscado a cada envio: com pausas a transmissão dura horas e a conexão pode ter sido refeita
                    const sock = await socketFor(sessionId);
                    await sock.sendMessage(jid, messageContent);
                    sent++;

                    // Update recipient status in DB
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, jid },
                        data: { status: "sent", sentAt: new Date() }
                    });
                } catch (e: any) {
                    failed++;
                    errors.push({ jid, error: e.message || "Unknown error" });
                    console.error(`Failed to send broadcast to ${jid}`, e);

                    // Update recipient error in DB
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, jid },
                        data: { status: "failed", error: e.message || "Unknown error" }
                    });
                }

                const progress = Math.round(((sent + failed) / normalizedRecipients.length) * 100);

                // Update BroadcastLog progress in DB
                await prisma.broadcastLog.update({
                    where: { id: broadcastId },
                    data: { sent, failed }
                });

                // Socket real-time
                if (io) {
                    io.to(sessionId).emit("broadcast.progress", {
                        broadcastId,
                        status: "running",
                        total: normalizedRecipients.length,
                        sent,
                        failed,
                        current: jid,
                        progress
                    });
                }

                // CNP: fim do bloco → pausa longa (no lugar do intervalo normal)
                if (blockMs && i < normalizedRecipients.length - 1 && Date.now() - blockStart >= blockMs) {
                    const resumeAt = new Date(Date.now() + pauseMs);
                    await prisma.broadcastLog.update({ where: { id: broadcastId }, data: { status: "paused" } });
                    if (io) {
                        io.to(sessionId).emit("broadcast.progress", {
                            broadcastId,
                            status: "paused",
                            total: normalizedRecipients.length,
                            sent,
                            failed,
                            current: null,
                            progress,
                            resumeAt: resumeAt.toISOString()
                        });
                    }
                    await sleep(pauseMs);
                    await prisma.broadcastLog.update({ where: { id: broadcastId }, data: { status: "running" } });
                    if (io) {
                        io.to(sessionId).emit("broadcast.progress", {
                            broadcastId,
                            status: "running",
                            total: normalizedRecipients.length,
                            sent,
                            failed,
                            current: null,
                            progress
                        });
                    }
                    blockStart = Date.now();
                } else if (i < normalizedRecipients.length - 1) {
                    const baseDelay = delay || 2000;
                    const randomDelay = baseDelay + Math.floor(Math.random() * (baseDelay * 0.5));
                    await new Promise(r => setTimeout(r, randomDelay));
                }
            }

            // Mark as completed in DB
            await prisma.broadcastLog.update({
                where: { id: broadcastId },
                data: { status: "completed", sent, failed, completedAt: new Date() }
            });

            // Final socket emit
            if (io) {
                io.to(sessionId).emit("broadcast.progress", {
                    broadcastId,
                    status: "completed",
                    total: normalizedRecipients.length,
                    sent,
                    failed,
                    errors,
                    progress: 100,
                    completedAt: new Date().toISOString()
                });
            }
            console.log(`Broadcast ${broadcastId} completed: ${sent} sent, ${failed} failed out of ${normalizedRecipients.length}`);
        })();

        return NextResponse.json({
            status: true,
            message: "Broadcast started",
            data: { broadcastId: log.id, total: normalizedRecipients.length }
        });

    } catch (e) {
        console.error("Broadcast error", e);
        return NextResponse.json({ status: false, message: "Failed to start broadcast", error: "Failed to start broadcast" }, { status: 500 });
    }
}
