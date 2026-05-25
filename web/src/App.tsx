import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  Channel,
  Attachment,
  Message,
  NotifyMode,
  User,
  VoiceParticipant,
  Hub,
  RoleInfo,
  NamedProfile,
  MeInfo,
  MemberAdminInfo,
  BanInfo,
  InviteInfo,
  PendingUser,
  InstalledGame,
  Conversation,
  DmMessage,
  AllianceInfo,
  AllianceSharedChannel,
  ActiveStream,
} from "@shared/types";
import { HubSidebar } from "@components/HubSidebar";
import { ChannelSidebar } from "@components/ChannelSidebar";
import { ContentArea } from "@components/ContentArea";
import { AddHubModal } from "@components/AddHubModal";
import { buildChannelTree } from "@shared/utils/channels";
import type { TreeNode } from "@shared/utils/channels";
import type { ScreenShareViewerRef } from "@components/ScreenShareViewer";
import {
  restorePersistedHubs,
  addHub,
  removeHub,
  setActiveHub,
  listHubs,
  pingHub,
  previewHubInfo,
  reorderHubs,
  hubFetch,
  HubApiError,
} from "@platform";
import type { WsHandlers } from "@platform";
import { getActiveHubId } from "@platform";
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
} from "@platform";
import {
  listConversations,
  createConversation,
  getDmMessages,
  sendDm,
  publishDhKey,
} from "@platform";
import {
  loadIdentity,
  generateIdentity,
  publicKeyHex,
  seedToPhrase,
  phraseToSeed,
  validatePhrase,
  saveIdentity,
} from "@identity/index";

// ---- Types ----

type Theme = "calm" | "classic" | "linear" | "light";
type View = "channels" | "dms" | "game";
type HubPreview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; url: string; name: string; description?: string | null; icon?: string | null; invite_only?: boolean; min_security_level?: number }
  | { state: "error"; message: string };

// ---- Identity Setup ----

function IdentitySetupScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<"choose" | "generated" | "recover">("choose");
  const [generatedPhrase, setGeneratedPhrase] = useState("");
  const [generatedSeed, setGeneratedSeed] = useState("");
  const [phrase, setPhrase] = useState("");
  const [hexInput, setHexInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function doGenerate() {
    const rec = await generateIdentity();
    setGeneratedSeed(rec.seed_hex);
    setGeneratedPhrase(seedToPhrase(rec.seed_hex));
    setStep("generated");
  }

  async function doRecoverPhrase() {
    setError(null);
    if (!validatePhrase(phrase)) { setError("Invalid recovery phrase."); return; }
    try {
      const hex = phraseToSeed(phrase);
      await saveIdentity({ id: "main", seed_hex: hex, security_nonce: 0, security_level: 0 });
      onComplete();
    } catch (e) { setError(String(e)); }
  }

  async function doRecoverHex() {
    setError(null);
    if (!/^[0-9a-fA-F]{64}$/.test(hexInput)) { setError("Must be 64 hex chars."); return; }
    try {
      await saveIdentity({ id: "main", seed_hex: hexInput.toLowerCase(), security_nonce: 0, security_level: 0 });
      onComplete();
    } catch (e) { setError(String(e)); }
  }

  if (step === "generated") {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 32 }}>
        <h2>Save your recovery phrase</h2>
        <p className="muted">Write these 24 words down and store them somewhere safe. Anyone with this phrase can control your identity.</p>
        <div style={{ background: "var(--bg-elevated)", padding: 16, borderRadius: "var(--r-md)", fontFamily: "monospace", lineHeight: 1.8, marginBottom: 16 }}>{generatedPhrase}</div>
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>Seed hex (alternative backup): <code>{generatedSeed}</code></p>
        <button className="btn-primary" onClick={onComplete} style={{ marginTop: 16 }}>
          I saved my phrase — Continue
        </button>
      </div>
    );
  }

  if (step === "recover") {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 32 }}>
        <h2>Recover identity</h2>
        <label className="settings-label">24-word recovery phrase</label>
        <textarea rows={3} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="word1 word2 word3 …" style={{ width: "100%", marginBottom: 8 }} />
        <button onClick={doRecoverPhrase} style={{ marginBottom: 16 }}>Recover from phrase</button>
        <label className="settings-label">Or seed hex (64 chars)</label>
        <input type="text" value={hexInput} onChange={(e) => setHexInput(e.target.value)} placeholder="a1b2c3d4…" style={{ width: "100%", fontFamily: "monospace", marginBottom: 8 }} />
        <button onClick={doRecoverHex} style={{ marginBottom: 8 }}>Recover from hex</button>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <br />
        <button className="btn-ghost" onClick={() => { setStep("choose"); setError(null); }}>Back</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: "120px auto", padding: 32, textAlign: "center" }}>
      <h1>Voxply</h1>
      <p className="muted">Create a new identity or recover an existing one.</p>
      <button className="btn-primary" style={{ width: "100%", marginBottom: 12 }} onClick={doGenerate}>
        Create new identity
      </button>
      <button className="btn-secondary" style={{ width: "100%" }} onClick={() => setStep("recover")}>
        Recover existing identity
      </button>
    </div>
  );
}

// ---- App ----

export default function App() {
  // === Identity ===
  const [ready, setReady] = useState<"checking" | "setup" | "ok">("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [theme, setTheme] = useState<Theme>("calm");

  // === Hubs ===
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [activeHubId, setActiveHubIdState] = useState<string | null>(null);
  const [hubConnected, setHubConnected] = useState<Record<string, boolean>>({});
  const [reconnectingHubs] = useState<Record<string, boolean>>({});
  const [pingByHub, setPingByHub] = useState<Record<string, number | null>>({});
  const [hubDropdownOpen, setHubDropdownOpen] = useState(false);
  const [hubUrl, setHubUrl] = useState("http://localhost:3000");
  const [inviteCode, setInviteCode] = useState("");
  const [hubPreview, setHubPreview] = useState<HubPreview>({ state: "idle" });
  const [addingHub, setAddingHub] = useState(false);
  const [addHubError, setAddHubError] = useState<string | null>(null);
  const [showAddHub, setShowAddHub] = useState(false);

  // === Hub data ===
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [meInfo, setMeInfo] = useState<MeInfo | null>(null);
  const [voicePartByChannel, setVoicePartByChannel] = useState<Record<string, VoiceParticipant[]>>({});
  const [voiceActiveUsers] = useState<Set<string>>(new Set());
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
  const [userAlliances, setUserAlliances] = useState<AllianceInfo[]>([]);
  const [allianceChannels] = useState<Record<string, AllianceSharedChannel[]>>({});

  // === View ===
  const [view, setView] = useState<View>("channels");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [selectedGame, setSelectedGame] = useState<InstalledGame | null>(null);

  // === Messages ===
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [newWhileScrolledUp, setNewWhileScrolledUp] = useState(0);
  const [memberSidebarHidden, setMemberSidebarHidden] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [firstNotifyingMessageId, setFirstNotifyingMessageId] = useState<string | null>(null);
  const [typingByKey] = useState<Record<string, { name: string; ts: number }>>({});
  const [allianceMessages] = useState<Message[]>([]);

  // === DMs ===
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [dmMessages, setDmMessages] = useState<Record<string, DmMessage[]>>({});
  const [dmTypingByKey] = useState<Record<string, { name: string; ts: number }>>({});

  // === Unread / notifications ===
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, Record<string, boolean>>>({});
  const [unreadDms, setUnreadDms] = useState<Record<string, boolean>>({});
  const [hubNotifyMode, setHubNotifyMode] = useState<Record<string, NotifyMode>>({});
  const [channelNotifyMode, setChannelNotifyMode] = useState<Record<string, Record<string, NotifyMode>>>({});
  const [pinnedChannels, setPinnedChannels] = useState<Record<string, Record<string, boolean>>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, Record<string, boolean>>>({});
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());

  // === Profiles ===
  const [namedProfiles] = useState<NamedProfile[]>([]);
  const [defaultProfileId] = useState<string | null>(null);

  // === Refs ===
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const screenShareViewerRef = useRef<ScreenShareViewerRef | null>(null);

  const loadingHub = useRef(false);

  // Voice-not-available toast
  const [voiceToast, setVoiceToast] = useState(false);

  // === Identity init ===

  useEffect(() => {
    loadIdentity().then((rec) => {
      if (rec) {
        setPublicKey(publicKeyHex(rec.seed_hex));
        setReady("ok");
      } else {
        setReady("setup");
      }
    });
  }, []);

  function handleIdentityComplete() {
    loadIdentity().then((rec) => {
      if (rec) setPublicKey(publicKeyHex(rec.seed_hex));
      setReady("ok");
    });
  }

  // Theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Document title (unread count)
  const unreadByHub = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [hub, m] of Object.entries(unreadByChannel)) {
      out[hub] = Object.keys(m).length;
    }
    return out;
  }, [unreadByChannel]);

  useEffect(() => {
    const total = Object.values(unreadByHub).reduce((n, v) => n + v, 0);
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Voxply` : "Voxply";
  }, [unreadByHub]);

  // === WS handlers (stable via ref) ===

  const activeHubIdRef = useRef<string | null>(null);
  useEffect(() => { activeHubIdRef.current = activeHubId; }, [activeHubId]);

  const selectedChannelRef = useRef<Channel | null>(null);
  useEffect(() => { selectedChannelRef.current = selectedChannel; }, [selectedChannel]);

  const selectedConvRef = useRef<Conversation | null>(null);
  useEffect(() => { selectedConvRef.current = selectedConversation; }, [selectedConversation]);

  const stableHandlers: WsHandlers = useMemo(() => ({
    onMessage: (raw) => {
      const m = raw as Record<string, unknown>;
      const type = m.type as string;
      if (type === "message") {
        const msg = m.message as Message | undefined;
        if (!msg) return;
        setMessages((prev) => prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]);
        const hub = activeHubIdRef.current;
        const selCh = selectedChannelRef.current;
        if (hub && m.channel_id && m.channel_id !== selCh?.id) {
          bumpUnread(hub, m.channel_id as string);
        }
        setStickToBottom((stick) => { if (stick) setNewWhileScrolledUp(0); else setNewWhileScrolledUp((n) => n + 1); return stick; });
      } else if (type === "message_edited") {
        const msg = m.message as Message | undefined;
        if (msg) setMessages((prev) => prev.map((x) => x.id === msg.id ? msg : x));
      } else if (type === "message_deleted") {
        const id = m.message_id as string;
        if (id) setMessages((prev) => prev.filter((x) => x.id !== id));
      }
    },
    onDm: (raw) => {
      const m = raw as Record<string, unknown>;
      const convId = m.conversation_id as string | undefined;
      if (!convId) return;
      setUnreadDms((prev) => ({ ...prev, [convId]: true }));
      // WS gives plaintext (or "[encrypted]" placeholder for encrypted).
      // Reload conversation messages so the browser client can auto-decrypt.
      if (convId === selectedConvRef.current?.id) {
        getDmMessages(convId).then((msgs) => {
          const asDm: DmMessage[] = msgs.map((mm) => ({
            sender: mm.sender,
            sender_name: mm.sender_name,
            content: mm.content,
            timestamp: mm.created_at,
            attachments: mm.attachments,
            is_encrypted: mm.is_encrypted,
            delivery_failed: mm.delivery_failed,
          }));
          setDmMessages((prev) => ({ ...prev, [convId]: asDm }));
        }).catch(() => {});
      }
    },
    onVoiceState: (raw) => {
      const m = raw as { channel_id?: string; participants?: VoiceParticipant[] };
      if (m.channel_id && m.participants) {
        setVoicePartByChannel((prev) => ({ ...prev, [m.channel_id!]: m.participants! }));
      }
    },
    onScreenShare: () => {},
    onStatusChange: (connected) => {
      const id = activeHubIdRef.current;
      if (id) setHubConnected((prev) => ({ ...prev, [id]: connected }));
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // === Hub restore on startup ===

  useEffect(() => {
    if (ready !== "ok") return;
    async function restore() {
      const list = await restorePersistedHubs(stableHandlers);
      setHubs(list);
      const id = getActiveHubId();
      if (id) {
        setActiveHubIdState(id);
        await loadHubData();
        publishDhKey().catch(() => {});
      }
    }
    void restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // === Helpers ===

  function bumpUnread(hubId: string, channelId: string) {
    setUnreadByChannel((prev) => ({
      ...prev,
      [hubId]: { ...(prev[hubId] ?? {}), [channelId]: true },
    }));
  }

  function clearUnread(hubId: string, channelId: string) {
    setUnreadByChannel((prev) => {
      const m = prev[hubId];
      if (!m?.[channelId]) return prev;
      const { [channelId]: _, ...rest } = m;
      return { ...prev, [hubId]: rest };
    });
  }

  function clearHubUnread(hubId: string) {
    setUnreadByChannel((prev) => ({ ...prev, [hubId]: {} }));
  }

  function effectiveNotifyMode(hubId: string, channelId: string): NotifyMode {
    return channelNotifyMode[hubId]?.[channelId] ?? hubNotifyMode[hubId] ?? "all";
  }

  // === Hub data loading ===

  async function loadHubData() {
    if (loadingHub.current) return;
    loadingHub.current = true;
    try {
      const [ch, usr, me, convs, games, alliances] = await Promise.allSettled([
        hubFetch("/channels").then((r) => r.json() as Promise<Channel[]>),
        hubFetch("/users").then((r) => r.json() as Promise<User[]>),
        hubFetch("/me").then((r) => r.json() as Promise<MeInfo>),
        hubFetch("/conversations").then((r) => r.json() as Promise<Conversation[]>),
        hubFetch("/hub/games").then((r) => r.json() as Promise<InstalledGame[]>),
        hubFetch("/alliances").then((r) => r.json() as Promise<AllianceInfo[]>).catch(() => [] as AllianceInfo[]),
      ]);
      if (ch.status === "fulfilled") setChannels(ch.value);
      if (usr.status === "fulfilled") setUsers(usr.value);
      if (me.status === "fulfilled") setMeInfo(me.value);
      if (convs.status === "fulfilled") setConversations(convs.value);
      if (games.status === "fulfilled") setInstalledGames(games.value);
      if (alliances.status === "fulfilled") setUserAlliances(alliances.value);
    } finally {
      loadingHub.current = false;
    }
  }

  // === Hub management ===

  async function handleSwitchHub(hubId: string) {
    setActiveHub(hubId);
    setActiveHubIdState(hubId);
    setSelectedChannel(null);
    setSelectedConversation(null);
    setMessages([]);
    setView("channels");
    await loadHubData();
  }

  async function handleRemoveHub(hubId: string) {
    await removeHub(hubId);
    const list = listHubs();
    setHubs(list);
    if (activeHubId === hubId) {
      const next = list[0]?.hub_id ?? null;
      setActiveHubIdState(next);
      setSelectedChannel(null);
      setSelectedConversation(null);
      if (next) await loadHubData();
    }
  }

  function handleHubReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setHubs((prev) => {
      const next = arrayMove(
        prev,
        prev.findIndex((h) => h.hub_id === active.id),
        prev.findIndex((h) => h.hub_id === over.id),
      );
      reorderHubs(next.map((h) => h.hub_id)).catch(() => {});
      return next;
    });
  }

  async function handlePreviewHub() {
    setHubPreview({ state: "loading" });
    setAddHubError(null);
    try {
      const info = await previewHubInfo(hubUrl);
      setHubPreview({ state: "ok", url: hubUrl, name: info.name, icon: info.icon });
    } catch (e) {
      setHubPreview({ state: "error", message: String(e) });
    }
  }

  async function handleAddHub() {
    setAddingHub(true);
    setAddHubError(null);
    try {
      const hub = await addHub(hubUrl, stableHandlers, { invite_code: inviteCode || undefined });
      setHubs(listHubs());
      setActiveHubIdState(hub.hub_id);
      setShowAddHub(false);
      setHubUrl("http://localhost:3000");
      setInviteCode("");
      setHubPreview({ state: "idle" });
      await loadHubData();
      publishDhKey().catch(() => {});
    } catch (e) {
      setAddHubError(e instanceof HubApiError ? e.message : String(e));
    } finally {
      setAddingHub(false);
    }
  }

  // === Channel / messages ===

  async function handleSelectChannel(ch: Channel) {
    setSelectedChannel(ch);
    setSelectedConversation(null);
    setView("channels");
    setMessages([]);
    setReplyTarget(null);
    setEditingMessageId(null);
    if (activeHubId) clearUnread(activeHubId, ch.id);
    try {
      const msgs = await getMessages(ch.id);
      setMessages(msgs);
      setStickToBottom(true);
      setNewWhileScrolledUp(0);
    } catch {}
  }

  async function handleSend() {
    if (!selectedChannel || !inputText.trim()) return;
    const text = inputText.trim();
    setInputText("");
    try {
      await sendMessage(selectedChannel.id, text, pendingAttachments.length ? pendingAttachments : undefined, replyTarget?.id);
      setPendingAttachments([]);
      setReplyTarget(null);
    } catch {}
  }

  async function handleSaveEdit() {
    if (!editingMessageId || !editingDraft.trim() || !selectedChannel) return;
    try {
      await editMessage(selectedChannel.id, editingMessageId, editingDraft.trim());
      setEditingMessageId(null);
      setEditingDraft("");
    } catch {}
  }

  function handleCancelEdit() { setEditingMessageId(null); setEditingDraft(""); }

  function handleStartEdit(msg: Message) {
    setEditingMessageId(msg.id);
    setEditingDraft(msg.content);
  }

  async function handleDeleteMessage(msgId: string) {
    if (!selectedChannel) return;
    try {
      await deleteMessage(selectedChannel.id, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch {}
  }

  async function handleToggleReaction(msgId: string, emoji: string) {
    if (!selectedChannel) return;
    const msg = messages.find((m) => m.id === msgId);
    const existing = msg?.reactions?.find((r) => r.emoji === emoji);
    try {
      if (existing?.me) await removeReaction(selectedChannel.id, msgId, emoji);
      else await addReaction(selectedChannel.id, msgId, emoji);
    } catch {}
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    if (e.key === "Escape") { setReplyTarget(null); setEditingMessageId(null); }
  }

  // === DMs ===

  async function handleSelectConversation(conv: Conversation) {
    setSelectedConversation(conv);
    setSelectedChannel(null);
    setView("dms");
    setUnreadDms((prev) => { const n = { ...prev }; delete n[conv.id]; return n; });
    if (!dmMessages[conv.id]) {
      try {
        const msgs = await getDmMessages(conv.id);
        const asDmMessages: DmMessage[] = msgs.map((m) => ({
          sender: m.sender,
          sender_name: m.sender_name,
          content: m.content,
          timestamp: m.created_at,
          attachments: m.attachments,
          is_encrypted: m.is_encrypted,
          delivery_failed: m.delivery_failed,
        }));
        setDmMessages((prev) => ({ ...prev, [conv.id]: asDmMessages }));
      } catch {}
    }
  }

  async function handleSendDm() {
    if (!selectedConversation || !inputText.trim()) return;
    const text = inputText.trim();
    setInputText("");
    try {
      await sendDm(selectedConversation.id, text);
    } catch {}
  }

  // === Voice (not available in browser) ===

  function showVoiceNotAvailable() {
    setVoiceToast(true);
    setTimeout(() => setVoiceToast(false), 4000);
  }

  // === Misc helpers ===

  function handleCopyKey() {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey).catch(() => {});
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  function handleShowRecovery() {
    loadIdentity().then((rec) => {
      if (rec) setRecoveryPhrase(seedToPhrase(rec.seed_hex));
    });
  }

  async function handleRecoverIdentity(ph: string) {
    if (!validatePhrase(ph)) throw new Error("Invalid phrase");
    const hex = phraseToSeed(ph);
    await saveIdentity({ id: "main", seed_hex: hex, security_nonce: 0, security_level: 0 });
    setPublicKey(publicKeyHex(hex));
    setRecoveryPhrase(null);
  }

  const isAdmin = useMemo(
    () => meInfo?.roles?.some((r) => r.permissions?.includes("manage_hub")) ?? false,
    [meInfo],
  );

  const myRoles = useMemo(() => meInfo?.roles ?? [], [meInfo]);

  const canManageGames = useMemo(
    () => myRoles.some((r) => r.permissions?.includes("manage_games") || r.permissions?.includes("manage_hub")),
    [myRoles],
  );

  const knownDisplayNames = useMemo(
    () => new Set(users.map((u) => u.display_name).filter(Boolean) as string[]),
    [users],
  );

  const channelTree = useMemo<TreeNode[]>(
    () => buildChannelTree(channels),
    [channels],
  );

  // === Render ===

  if (ready === "checking") {
    return <div style={{ padding: 32 }}>Loading…</div>;
  }

  if (ready === "setup") {
    return <IdentitySetupScreen onComplete={handleIdentityComplete} />;
  }

  return (
    <div className="app-layout">
      {voiceToast && (
        <div
          style={{
            position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--r-md)", padding: "8px 16px", zIndex: 9999,
            fontSize: "var(--text-sm)", color: "var(--text)",
          }}
        >
          Voice is not available in the browser client. Open Voxply on your desktop to join.
        </div>
      )}

      <HubSidebar
        hubs={hubs}
        activeHubId={activeHubId}
        view={view as "channels" | "dms"}
        showDiscover={false}
        unreadDms={unreadDms}
        unreadByHub={unreadByHub}
        pingByHub={pingByHub}
        hubNotifyMode={hubNotifyMode}
        hasActiveHub={!!activeHubId}
        onSwitchToDms={() => setView("dms")}
        onSwitchHub={handleSwitchHub}
        onRemoveHub={handleRemoveHub}
        onHubReorder={handleHubReorder}
        onAddHub={() => setShowAddHub(true)}
        onDiscover={() => {}}
      />

      <ChannelSidebar
        view={view as "channels" | "dms"}
        activeHubId={activeHubId}
        hubs={hubs}
        channels={channels}
        selectedChannel={selectedChannel}
        unreadByChannel={unreadByChannel}
        collapsedCategories={collapsedCategories}
        voicePartByChannel={voicePartByChannel}
        voiceChannelId={null}
        selfMuted={false}
        selfDeafened={false}
        users={users}
        publicKey={publicKey}
        pingByHub={pingByHub}
        isAdmin={isAdmin}
        hubNotifyMode={hubNotifyMode}
        hubDropdownOpen={hubDropdownOpen}
        userAlliances={userAlliances}
        allianceChannels={allianceChannels}
        selectedAllianceChannel={null}
        conversations={conversations}
        selectedConversation={selectedConversation}
        unreadDms={unreadDms}
        channelTree={channelTree}
        effectiveNotifyMode={effectiveNotifyMode}
        onToggleCategoryCollapsed={(hubId, catId) =>
          setCollapsedCategories((prev) => {
            const m = { ...(prev[hubId] ?? {}) };
            if (m[catId]) delete m[catId]; else m[catId] = true;
            return { ...prev, [hubId]: m };
          })
        }
        onHubDropdownOpenChange={setHubDropdownOpen}
        onSetHubMode={(hubId, mode) =>
          setHubNotifyMode((prev) => { const n = { ...prev }; if (mode === "all") delete n[hubId]; else n[hubId] = mode; return n; })
        }
        onClearHubUnread={clearHubUnread}
        onRemoveHub={handleRemoveHub}
        onOpenHubAdmin={() => {}}
        onOpenHubAdminInvites={() => {}}
        onOpenCreateChannel={() => {}}
        onSelectChannel={handleSelectChannel}
        onChannelContextMenu={() => {}}
        onVoiceJoin={() => showVoiceNotAvailable()}
        onVoiceLeave={() => {}}
        onSelectAllianceChannel={() => {}}
        onSelectConversation={handleSelectConversation}
        onOpenFriends={() => {}}
        onToggleSelfMute={() => {}}
        onToggleSelfDeafen={() => {}}
        onOpenSettings={() => {}}
        onDragEnd={() => {}}
        sharing={false}
        onScreenShare={() => {}}
      />

      <ContentArea
        view={view as "channels" | "dms"}
        activeHubId={activeHubId}
        hubs={hubs}
        theme={theme}
        selectedChannel={selectedChannel}
        selectedConversation={selectedConversation}
        selectedAllianceChannel={null}
        messages={messages}
        searchResults={searchResults}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        dmMessages={dmMessages}
        allianceMessages={allianceMessages}
        users={users}
        publicKey={publicKey}
        blockedUsers={blockedUsers}
        knownDisplayNames={knownDisplayNames}
        myDisplayName={meInfo?.display_name ?? null}
        isAdmin={isAdmin}
        myRoles={myRoles}
        editingMessageId={editingMessageId}
        editingDraft={editingDraft}
        replyTarget={replyTarget}
        pendingAttachments={pendingAttachments}
        stickToBottom={stickToBottom}
        newWhileScrolledUp={newWhileScrolledUp}
        hubConnected={hubConnected}
        reconnectingHubs={reconnectingHubs}
        memberSidebarHidden={memberSidebarHidden}
        voiceActiveUsers={voiceActiveUsers}
        inputText={inputText}
        typingByKey={typingByKey}
        dmTypingByKey={dmTypingByKey}
        messagesEndRef={messagesEndRef}
        messagesContainerRef={messagesContainerRef}
        messageInputRef={messageInputRef}
        onReconnect={() => {}}
        onToggleReaction={handleToggleReaction}
        onSetReplyTarget={setReplyTarget}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onStartEdit={handleStartEdit}
        onDeleteMessage={handleDeleteMessage}
        onSend={handleSend}
        onSendDm={handleSendDm}
        onSendAllianceMessage={() => {}}
        onPingTyping={() => {}}
        onPingDmTyping={() => {}}
        onSetPendingAttachments={setPendingAttachments}
        onAttachFiles={() => {}}
        onOpenEditDescription={() => {}}
        firstNotifyingMessageId={firstNotifyingMessageId}
        onClearFirstNotify={() => setFirstNotifyingMessageId(null)}
        onScrollToMessage={() => {}}
        onSetMemberSidebarHidden={setMemberSidebarHidden}
        onSetSearchOpen={setSearchOpen}
        onSetSearchQuery={setSearchQuery}
        onCloseSearch={() => { setSearchOpen(false); setSearchResults(null); setSearchQuery(""); }}
        onJumpToBottom={() => { setStickToBottom(true); setNewWhileScrolledUp(0); }}
        onMessagesScroll={() => {}}
        onSetUserContextMenu={() => {}}
        onSetEditingDraft={setEditingDraft}
        onInputTextChange={setInputText}
        onKeyDown={handleKeyDown}
        onOpenImage={() => {}}
        onToast={() => {}}
        onError={() => {}}
        activeScreenShares={[]}
        screenShareViewerRef={screenShareViewerRef}
      />

      {showAddHub && (
        <AddHubModal
          hubUrl={hubUrl}
          onHubUrlChange={(v) => { setHubUrl(v); setHubPreview({ state: "idle" }); setAddHubError(null); }}
          hubPreview={hubPreview}
          inviteCode={inviteCode}
          onInviteCodeChange={setInviteCode}
          loading={addingHub}
          error={addHubError}
          onAdd={handleAddHub}
          onClose={() => { setShowAddHub(false); setHubPreview({ state: "idle" }); setAddHubError(null); }}
        />
      )}
    </div>
  );
}
