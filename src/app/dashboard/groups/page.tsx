"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Plus, RefreshCw, Download } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// Define a type for Group if not already defined elsewhere
interface Group {
    id: string;
    subject: string;
    jid: string;
    participants?: any[];
}

export default function GroupsPage() {
    const t = useTranslations("groups");
    const tCommon = useTranslations("common");
    const { sessionId } = useSession();

    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    const [searchTerm, setSearchTerm] = useState("");

    const fetchGroups = async (sessId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/groups/${sessId}`);
            if (res.ok) {
                const data = await res.json();
                setGroups(data?.data || []);
            } else {
                setGroups([]);
            }
        } catch (error) {
            toast.error(t("createdFailed"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (sessionId) {
            fetchGroups(sessionId);
        } else {
            setGroups([]);
        }
    }, [sessionId]);

    const handleCreateGroup = async () => {
        if (!sessionId || !newGroupName) return;
        try {
            const res = await fetch(`/api/groups/${sessionId}/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, subject: newGroupName })
            });
            if (res.ok) {
                toast.success(t("createdSuccess"));
                setIsCreateOpen(false);
                setNewGroupName("");
                fetchGroups(sessionId);
            } else {
                toast.error(t("createdFailed"));
            }
        } catch (error) {
            toast.error(t("createdFailed"));
        }
    };

    const filteredGroups = groups.filter(g =>
        (g.subject || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.jid.includes(searchTerm)
    );

    // CNP: exportar participantes (marcados; sem marcação, os grupos visíveis no filtro)
    // a marcação vale só para a sessão em que foi feita (trocou de sessão, começa vazia)
    const [marked, setMarked] = useState<{ session: string | null; jids: Set<string> }>({ session: null, jids: new Set() });
    const [exporting, setExporting] = useState(false);
    const selected = marked.session === sessionId ? marked.jids : new Set<string>();
    const updateSelected = (fn: (next: Set<string>) => void) => {
        const next = new Set(selected);
        fn(next);
        setMarked({ session: sessionId, jids: next });
    };

    const toggle = (jid: string) =>
        updateSelected((next) => {
            if (next.has(jid)) next.delete(jid);
            else next.add(jid);
        });
    const allVisibleSelected = filteredGroups.length > 0 && filteredGroups.every((g) => selected.has(g.jid));
    const toggleAllVisible = () =>
        updateSelected((next) => {
            filteredGroups.forEach((g) => (allVisibleSelected ? next.delete(g.jid) : next.add(g.jid)));
        });

    const exportParticipants = async () => {
        if (!sessionId) return;
        const jids = selected.size ? [...selected] : searchTerm ? filteredGroups.map((g) => g.jid) : [];
        setExporting(true);
        try {
            const params = new URLSearchParams();
            if (jids.length) params.set("jids", jids.join(","));
            const res = await fetch(`/api/groups/${sessionId}/export?${params}`);
            if (!res.ok) {
                toast.error(t("exportFailed"));
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `participantes-grupos-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(
                t("exportDone", {
                    rows: Number(res.headers.get("X-Export-Rows") || 0),
                    groups: Number(res.headers.get("X-Export-Groups") || 0),
                    missing: Number(res.headers.get("X-Export-Missing-Phone") || 0),
                })
            );
        } catch (error) {
            toast.error(t("exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <Users className="h-5 w-5 sm:h-6 sm:w-6" /> {t("title")}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {sessionId ? t("subtitleActive") : t("subtitleNoSession")}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => sessionId && fetchGroups(sessionId)} disabled={loading || !sessionId}>
                            <RefreshCw className={`h-4 w-4 mr-1 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
                            {t("refresh")}
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={exportParticipants} disabled={exporting || !sessionId || filteredGroups.length === 0}>
                            <Download className={`h-4 w-4 mr-1 sm:mr-2 ${exporting ? 'animate-pulse' : ''}`} />
                            {exporting
                                ? t("exporting")
                                : selected.size
                                    ? t("exportSelected", { count: selected.size })
                                    : searchTerm
                                        ? t("exportSelected", { count: filteredGroups.length })
                                        : t("exportAll")}
                        </Button>
                        <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setIsCreateOpen(true)} disabled={!sessionId}>
                            <Plus className="h-4 w-4 mr-1 sm:mr-2" /> {t("create")}
                        </Button>
                    </div>
                </div>

                <SearchFilter
                    placeholder={t("searchPlaceholder")}
                    onSearch={setSearchTerm}
                />

                {/* Create Dialog */}
                {isCreateOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="bg-white dark:bg-background p-4 sm:p-6 rounded-lg shadow-lg w-full max-w-sm">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">{t("dialogCreateTitle")}</h2>
                            <div className="space-y-4">
                                <div>
                                    <Label>{t("subjectLabel")}</Label>
                                    <Input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder={t("subjectPlaceholder")} />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>{tCommon("cancel")}</Button>
                                    <Button onClick={handleCreateGroup}>{t("create")}</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Groups List */}
                {loading ? (
                    <div className="text-center p-8">{tCommon("loading")}</div>
                ) : filteredGroups.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground border rounded-lg bg-slate-50">
                        {sessionId ? t("noGroupsMatching") : t("noSessionSelected")}
                    </div>
                ) : (
                    <>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer w-fit">
                        <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} />
                        {t("selectAllVisible", { count: filteredGroups.length })}
                    </label>
                    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredGroups.map(group => (
                            <label key={group.id} className="bg-white p-4 rounded-lg shadow border flex gap-3 items-start cursor-pointer">
                                <Checkbox className="mt-1" checked={selected.has(group.jid)} onCheckedChange={() => toggle(group.jid)} aria-label={group.subject} />
                                <div className="min-w-0">
                                    <h3 className="font-bold text-lg">{group.subject}</h3>
                                    <div className="text-xs text-muted-foreground mt-1 break-all">{group.jid}</div>
                                    <div className="text-xs text-slate-500 mt-1">{t("participantsCount", { count: group.participants?.length || 0 })}</div>
                                </div>
                            </label>
                        ))}
                    </div>
                    </>
                )}
            </div>
        </SessionGuard>
    );
}
