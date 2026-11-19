import { NextResponse, NextRequest } from "next/server";
import { jidDecode, type WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { syncGroups } from "@/modules/whatsapp/store/groups";

/**
 * CNP: exporta os participantes dos grupos da sessão.
 *
 * GET /api/groups/{sessionId}/export
 *   ?jids=a@g.us,b@g.us   só estes grupos (padrão: todos)
 *   ?format=csv|json      padrão csv (separador ";", UTF-8 com BOM, abre direto no Excel)
 *
 * Uma linha por pessoa por grupo. Com a sessão conectada, a lista de participantes é
 * atualizada no WhatsApp antes de exportar; desconectada, usa a última cópia do banco.
 *
 * Telefone: o WhatsApp esconde o número de parte dos participantes (aparecem como
 * "…@lid"). Tenta recuperar pelo próprio participante, pelo mapa LID→número da sessão e
 * pela tabela de contatos; quando não dá, a linha sai com telefone vazio e o id @lid.
 */

type Participant = { id: string; lid?: string; phoneNumber?: string; notify?: string; admin?: string | null };

const userOf = (jid?: string | null) => (jid ? jidDecode(jid)?.user ?? null : null);
const isPn = (jid?: string | null) => !!jid && jid.endsWith("@s.whatsapp.net");
const isLid = (jid?: string | null) => !!jid && jid.endsWith("@lid");

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        const { sessionId } = await params;
        if (!(await canAccessSession(user.id, user.role, sessionId))) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }
        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const instance = waManager.getInstance(sessionId);
        const sock = instance?.status === "CONNECTED" ? (instance.socket as WASocket | undefined) : undefined;
        if (sock) await syncGroups(sock, sessionId);

        const sp = request.nextUrl.searchParams;
        const jids = (sp.get("jids") || "").split(",").map((s) => s.trim()).filter(Boolean);
        const groups = await prisma.group.findMany({
            where: { sessionId: session.id, ...(jids.length ? { jid: { in: jids } } : {}) },
            select: { jid: true, subject: true, participants: true },
            orderBy: { subject: "asc" },
        });

        const all = groups.flatMap((g) =>
            ((g.participants as Participant[] | null) ?? []).map((p) => ({ g, p }))
        );

        // LID → número: primeiro o mapa da sessão (Baileys), depois a tabela de contatos
        const lids = [...new Set(all.flatMap(({ p }) => [p.id, p.lid]).filter(isLid))] as string[];
        const pnByLid = new Map<string, string>();
        if (sock && lids.length) {
            try {
                const found = await sock.signalRepository.lidMapping.getPNsForLIDs(lids);
                found?.forEach((m) => { if (m.lid && m.pn) pnByLid.set(m.lid, m.pn); });
            } catch {
                // sem mapa: segue para a tabela de contatos
            }
        }
        const ids = [...new Set(all.flatMap(({ p }) => [p.id, p.lid, p.phoneNumber]).filter(Boolean))] as string[];
        const contacts = await prisma.contact.findMany({
            where: { sessionId: session.id, OR: [{ jid: { in: ids } }, { lid: { in: ids } }] },
            select: { jid: true, lid: true, remoteJidAlt: true, name: true, notify: true, verifiedName: true },
        });
        const contactBy = new Map<string, (typeof contacts)[number]>();
        contacts.forEach((c) => {
            contactBy.set(c.jid, c);
            if (c.lid) contactBy.set(c.lid, c);
        });

        const rows = all.map(({ g, p }) => {
            const lid = isLid(p.id) ? p.id : isLid(p.lid) ? p.lid! : null;
            const c = contactBy.get(p.id) ?? (p.lid ? contactBy.get(p.lid) : undefined) ?? (p.phoneNumber ? contactBy.get(p.phoneNumber) : undefined);
            const pnJid =
                [p.id, p.phoneNumber, lid ? pnByLid.get(lid) : null, c?.jid, c?.remoteJidAlt].find(isPn) ?? null;
            return {
                grupo: g.subject ?? "",
                grupo_jid: g.jid,
                telefone: userOf(pnJid) ?? "",
                nome: c?.name || c?.notify || p.notify || c?.verifiedName || "",
                admin: p.admin ? "sim" : "não",
                id_whatsapp: p.id,
            };
        });

        const semTelefone = rows.filter((r) => !r.telefone).length;
        if (sp.get("format") === "json") {
            return NextResponse.json({
                status: true,
                message: "Participants exported",
                data: rows,
                meta: { grupos: groups.length, linhas: rows.length, semTelefone, atualizado: !!sock },
            });
        }

        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const cols = ["grupo", "grupo_jid", "telefone", "nome", "admin", "id_whatsapp"] as const;
        const csv = "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((k) => esc(r[k])).join(";"))].join("\r\n");
        const dia = new Date().toISOString().slice(0, 10);
        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="participantes-grupos-${dia}.csv"`,
                "Cache-Control": "no-store",
                "X-Export-Groups": String(groups.length),
                "X-Export-Rows": String(rows.length),
                "X-Export-Missing-Phone": String(semTelefone),
            },
        });
    } catch (error) {
        console.error("Export group participants error:", error);
        return NextResponse.json({ status: false, message: "Failed to export participants", error: "Failed to export participants" }, { status: 500 });
    }
}
