import { prisma } from "@/lib/prisma";
import type { WASocket, GroupMetadata } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

/** Grava (cria ou atualiza) um grupo da sessão. `dbSessionId` é o id interno (cuid). */
export async function upsertGroup(dbSessionId: string, g: GroupMetadata) {
    const dados = {
        subject: g.subject,
        description: g.desc,
        ownerJid: g.owner,
        restrict: g.restrict,
        announce: g.announce,
        participants: g.participants as any,
        metadata: g as any,
        isCommunity: g.isCommunity || false,
        linkedParentJid: g.linkedParent || null
    };
    await prisma.group.upsert({
        where: { sessionId_jid: { sessionId: dbSessionId, jid: g.id } },
        create: {
            sessionId: dbSessionId,
            jid: g.id,
            creation: g.creation ? new Date(g.creation * 1000) : undefined,
            ...dados
        },
        update: dados
    });
}

/**
 * Busca no WhatsApp todos os grupos em que o chip está e espelha no banco.
 * CNP: também apaga os grupos de que o chip saiu (só quando a busca deu certo).
 */
export async function syncGroups(sock: WASocket, sessionId: string): Promise<number | null> {
    try {
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) {
            logger.error("Store", `Session ${sessionId} does not exist, cannot sync groups`);
            return null;
        }
        const dbSessionId = session.id;

        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups);

        logger.info("Store", `Found ${groupList.length} groups for session ${sessionId}`);

        for (const g of groupList) {
            try {
                await upsertGroup(dbSessionId, g);
            } catch (e) {
                logger.error("Store", `Failed to sync group ${g.id}`, e);
            }
        }

        await prisma.group.deleteMany({
            where: { sessionId: dbSessionId, jid: { notIn: groupList.map((g) => g.id) } }
        });

        logger.success("Store", `Synced ${groupList.length} groups for session ${sessionId}`);
        return groupList.length;
    } catch (e) {
        logger.error("Store", "Failed to sync groups", e);
        return null;
    }
}
