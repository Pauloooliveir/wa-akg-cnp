import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { syncGroups } from "@/modules/whatsapp/store/groups";
import type { WASocket } from "@whiskeysockets/baileys";

// GET: List groups for a session
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

        // Verify access
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Get internal ID
        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // CNP: ?refresh=1 busca a lista no WhatsApp antes de responder (pega grupos novos)
        if (request.nextUrl.searchParams.get("refresh") === "1") {
            const instance = waManager.getInstance(sessionId);
            if (!instance?.socket || instance.status !== "CONNECTED") {
                return NextResponse.json({ status: false, message: "Session not connected", error: "Session not connected" }, { status: 409 });
            }
            const total = await syncGroups(instance.socket as WASocket, sessionId);
            if (total === null) {
                return NextResponse.json({ status: false, message: "Failed to refresh groups", error: "Failed to refresh groups" }, { status: 502 });
            }
        }

        const groups = await prisma.group.findMany({
            where: { sessionId: session.id },
            orderBy: { subject: 'asc' }
        });

        return NextResponse.json({ status: true, message: "Groups retrieved successfully", data: groups });
    } catch (error) {
        console.error("Get groups error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch groups", error: "Failed to fetch groups" }, { status: 500 });
    }
}
