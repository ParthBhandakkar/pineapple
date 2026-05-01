"use client";

import {
  DragEvent,
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import {
  Activity,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  CreditCard,
  Download,
  Eye,
  FileCode2,
  FileText,
  Folder,
  Inbox,
  LogOut,
  Mail,
  MessageSquareText,
  Mic,
  MicOff,
  Moon,
  Paperclip,
  Plug,
  Plus,
  Rocket,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Store,
  Sun,
  Terminal as TerminalIcon,
  TerminalSquare,
  Trash2,
  User as UserIcon,
  UserCog,
  Users,
  X,
  Zap,
} from "lucide-react";
import { billingModels, defaultBillingModelCode, getAllowedMaxMultiplier } from "@/lib/models";
import { persistThemeMode, readStoredThemeMode, type ThemeMode } from "@/lib/theme";
import { AuthPanel } from "@/components/AuthPanel";
import { useToast } from "@/components/ui/Toast";
import { ConfirmModal, InfoModal } from "@/components/ui/ConfirmModal";
import { ProfilePopover, type ProfileMenuItem } from "@/components/ui/ProfilePopover";

/* ============================ Types ============================ */

type User = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
};

type Plan = {
  id: string;
  code: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  monthlyPriceInr: number;
  monthlyTokens: number;
  maxAgents: number;
  isCustom: boolean;
  isActive: boolean;
};

type TokenPack = {
  id: string;
  code: string;
  name: string;
  tokens: number;
  priceInr: number;
  isActive?: boolean;
};

type ChatAttachment = {
  id: string;
  file: globalThis.File;
  name: string;
  size: number;
  mime: string;
  preview: string | null;
};

type Wallet = {
  subscriptionTokensRemaining: number;
  purchasedTokensRemaining: number;
  resetAt: string;
};

type Agent = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  isDefault: boolean;
  isActive?: boolean;
};

type UserAgent = {
  id: string;
  agentId: string;
  status: string;
  deployedAt: string | null;
  agent: Agent;
};

type Message = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: string;
  tokenEstimate?: number;
};

type ProjectFile = {
  path: string;
  content: string;
};

type ProjectArtifact = {
  name: string;
  entry?: string;
  files: ProjectFile[];
};

type Conversation = {
  id: string;
  title: string;
  opencodeSessionId: string | null;
  agent: Agent | null;
  messages: Message[];
  updatedAt?: string;
};

type Task = {
  id: string;
  prompt: string;
  status: string;
  actionType: string;
  riskLevel: string;
  result: string | null;
  tokenCost: number;
  createdAt: string;
  agent: Agent | null;
};

type Approval = {
  id: string;
  status: string;
  actionType: string;
  payload: string;
  createdAt: string;
  task: Task;
};

type Notification = {
  id: string;
  title: string;
  body: string;
  surface?: string;
  kind?: string;
  readAt: string | null;
  createdAt: string;
};

type Transaction = {
  id: string;
  amountInr: number;
  kind: string;
  status: string;
  createdAt: string;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
};

type AdminAgent = Agent & {
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number; conversations: number; tasks: number };
};

type AdminPaymentTransaction = Transaction & {
  user: { id: string; name: string; email: string };
};

type AdminAuditLog = SystemLog & {
  userId?: string | null;
  user?: { id: string; name: string; email: string; role?: string } | null;
};

type AdminAuditUserSummary = {
  user: { id: string; name: string; email: string; role: string };
  count: number;
};

type SystemLog = {
  id: string;
  level: string;
  event: string;
  summary: string;
  createdAt: string;
};

type AppData = {
  user: User;
  entitlement: {
    plan: Plan;
    currentPeriodEnd: string;
  };
  wallet: Wallet | null;
  plans: Plan[];
  tokenPacks: TokenPack[];
  agents: Agent[];
  userAgents: UserAgent[];
  conversations: Conversation[];
  tasks: Task[];
  approvals: Approval[];
  notifications: Notification[];
  transactions: Transaction[];
  logs: SystemLog[];
};

type AdminOverview = {
  metrics: {
    users: number;
    activeSubscriptions: number;
    revenueInr: number;
    taskCounts: Array<{ status: string; _count: { status: number } }>;
  };
  plans: Plan[];
  tokenPacks: TokenPack[];
  logs: Array<SystemLog & { user?: { email: string } | null }>;
};

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
  wallet: { subscriptionTokensRemaining: number; purchasedTokensRemaining: number } | null;
  subscriptions: Array<{ plan: { code: string; name: string } }>;
  _count: { tasks: number; conversations: number; transactions: number };
};

type AdminUserDetail = AdminUser & {
  wallet: {
    subscriptionTokensRemaining: number;
    purchasedTokensRemaining: number;
    resetAt: string;
  } | null;
  agents: Array<UserAgent & { agent: Agent }>;
  transactions: Transaction[];
  _count: AdminUser["_count"] & { messages: number; notifications: number };
};

type TabKey =
  | "chat"
  | "myAgents"
  | "marketplace"
  | "connectors"
  | "notifications"
  | "request"
  | "tasks";

type ProfileTabKey = "profile" | "logs" | "billing" | "live";

type MarketplaceSubTab = "subscription" | "tokens" | "agents";
type BillingSubTab = "subscription" | "tokens";

const sidebarTabs: Array<{
  key: TabKey;
  label: string;
  icon: typeof MessageSquareText;
  badge?: "notifications" | "requests";
}> = [
  { key: "chat", label: "Chat", icon: MessageSquareText },
  { key: "myAgents", label: "My Agents", icon: Bot },
  { key: "marketplace", label: "Marketplace", icon: Store },
  { key: "connectors", label: "Connectors", icon: Plug },
  { key: "notifications", label: "Notifications", icon: Bell, badge: "notifications" },
  { key: "request", label: "Requests", icon: Inbox, badge: "requests" },
  { key: "tasks", label: "Tasks", icon: Activity },
];

/* ============================ Helpers ============================ */

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatMoney(value: number) {
  if (value === 0) return "Free";
  return `₹${formatNumber(value)}`;
}

function formatBytes(value: number) {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log10(value) / Math.log10(1024)));
  return `${(value / Math.pow(1024, power)).toFixed(power > 1 ? 1 : 0)} ${units[power]}`;
}

function ratePerOneThousand(priceInr: number, tokens: number) {
  if (!tokens) return "₹0";
  const per1k = (priceInr / tokens) * 1000;
  return `₹${per1k.toFixed(2)}/1k`;
}

function formatTokenShort(value: number) {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`.replace(".0M", "M");
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return formatNumber(value);
}

function userInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function planTone(code: string): "indigo" | "teal" | "amber" | "" {
  const c = code.toLowerCase();
  if (c === "free" || c === "starter" || c === "basic") return "indigo";
  if (c === "silver" || c === "professional") return "teal";
  if (c === "pro") return "amber";
  return "";
}

function agentCapabilities(agent: Agent) {
  const parts = agent.description
    .split(/[.!?\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const baseline = [
    "Natural language understanding",
    "Multi-step reasoning for your prompts",
    "Context-aware follow-ups in this session",
  ];
  return (parts.length >= 3 ? parts : [...parts, ...baseline]).slice(0, 4);
}

function statusBadgeClass(status: string) {
  const s = status.toUpperCase();
  if (s === "COMPLETED") return "badge badge-ok";
  if (s === "PENDING_APPROVAL" || s === "QUEUED") return "badge badge-warn";
  if (s === "RUNNING") return "badge badge-info";
  if (s === "REJECTED" || s === "FAILED") return "badge badge-bad";
  return "badge badge-mid";
}

function selectedModelInfo(code: string) {
  return billingModels.find((model) => model.code === code) ?? billingModels[0];
}

async function readApiError(response: Response) {
  const text = await response.text().catch(() => "");

  if (!text) {
    return `Request failed (${response.status} ${response.statusText || "no body"})`;
  }

  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    const message = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : null;
    if (message) return message;
  } catch {
    // Fall through to text below.
  }

  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : `Request failed (${response.status})`;
}

async function loadRazorpayScript() {
  if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function isProjectArtifact(value: unknown): value is ProjectArtifact {
  const artifact = value as ProjectArtifact | null;
  return (
    Boolean(artifact) &&
    typeof artifact?.name === "string" &&
    Array.isArray(artifact.files) &&
    artifact.files.length > 0 &&
    artifact.files.every((file) => typeof file.path === "string" && typeof file.content === "string")
  );
}

function parseJsonObjectSlice(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(value.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function decodeEscapedContent(value: string) {
  let decoded = value.trim();

  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (typeof parsed !== "string" || parsed === decoded) break;
      decoded = parsed.trim();
    } catch {
      break;
    }
  }

  if (decoded.includes('\\"') && !decoded.includes('"name"')) {
    try {
      const parsed = JSON.parse(`"${decoded.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`) as unknown;
      if (typeof parsed === "string") {
        decoded = parsed.trim();
      }
    } catch {
      // Leave the original text visible if it is not an escaped artifact string.
    }
  }

  return decoded;
}

function artifactFromUnknown(value: unknown): ProjectArtifact | null {
  if (isProjectArtifact(value)) return value;

  if (value && typeof value === "object") {
    const maybeWrapped = value as { content?: unknown; artifact?: unknown; project?: unknown };
    return (
      artifactFromUnknown(maybeWrapped.artifact) ??
      artifactFromUnknown(maybeWrapped.project) ??
      (typeof maybeWrapped.content === "string" ? artifactFromText(maybeWrapped.content).artifact : null)
    );
  }

  return null;
}

function artifactFromText(content: string): { intro: string; artifact: ProjectArtifact | null } {
  const normalized = decodeEscapedContent(content);
  const fenced = normalized.match(/```(?:pineapple-project|json)?\s*([\s\S]*?)```/);

  if (fenced) {
    const artifact = artifactFromUnknown(parseJsonObjectSlice(fenced[1]));
    if (artifact) {
      return {
        intro: normalized.replace(fenced[0], "").trim() || "I've created a complete project structure for you.",
        artifact,
      };
    }
  }

  const artifact = artifactFromUnknown(parseJsonObjectSlice(normalized));
  if (!artifact) return { intro: content, artifact: null };

  const intro = normalized.slice(0, normalized.indexOf("{")).trim();
  return {
    intro: intro || "I've created a complete project structure for you.",
    artifact,
  };
}

function parseProjectArtifact(content: string): { intro: string; artifact: ProjectArtifact | null } {
  return artifactFromText(content);
}

function safeProjectName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "pineapple-project"
  );
}

function buildPreviewHtml(artifact: ProjectArtifact) {
  const entry = artifact.files.find((file) => file.path === (artifact.entry ?? "index.html")) ?? artifact.files[0];
  if (!entry) return "";
  let html = entry.content;

  for (const file of artifact.files) {
    if (file.path.endsWith(".css")) {
      const escapedPath = file.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(
        new RegExp(`<link([^>]+)href=["']${escapedPath}["']([^>]*)>`, "g"),
        `<style>\n${file.content}\n</style>`,
      );
    }
    if (file.path.endsWith(".js")) {
      const escapedPath = file.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(
        new RegExp(`<script([^>]+)src=["']${escapedPath}["']([^>]*)></script>`, "g"),
        `<script>\n${file.content}\n</script>`,
      );
    }
  }

  return html;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZipBlob(files: ProjectFile[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const file of files) {
    const nameBytes = encoder.encode(file.path.replaceAll("\\", "/"));
    const contentBytes = encoder.encode(file.content);
    const crc = crc32(contentBytes);
    const local: number[] = [];
    writeU32(local, 0x04034b50);
    writeU16(local, 20);
    writeU16(local, 0);
    writeU16(local, 0);
    writeU16(local, dosTime);
    writeU16(local, dosDate);
    writeU32(local, crc);
    writeU32(local, contentBytes.length);
    writeU32(local, contentBytes.length);
    writeU16(local, nameBytes.length);
    writeU16(local, 0);
    chunks.push(new Uint8Array(local), nameBytes, contentBytes);

    const centralHeader: number[] = [];
    writeU32(centralHeader, 0x02014b50);
    writeU16(centralHeader, 20);
    writeU16(centralHeader, 20);
    writeU16(centralHeader, 0);
    writeU16(centralHeader, 0);
    writeU16(centralHeader, dosTime);
    writeU16(centralHeader, dosDate);
    writeU32(centralHeader, crc);
    writeU32(centralHeader, contentBytes.length);
    writeU32(centralHeader, contentBytes.length);
    writeU16(centralHeader, nameBytes.length);
    writeU16(centralHeader, 0);
    writeU16(centralHeader, 0);
    writeU16(centralHeader, 0);
    writeU16(centralHeader, 0);
    writeU32(centralHeader, 0);
    writeU32(centralHeader, offset);
    central.push(new Uint8Array(centralHeader), nameBytes);
    offset += local.length + nameBytes.length + contentBytes.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end: number[] = [];
  writeU32(end, 0x06054b50);
  writeU16(end, 0);
  writeU16(end, 0);
  writeU16(end, files.length);
  writeU16(end, files.length);
  writeU32(end, centralSize);
  writeU32(end, offset);
  writeU16(end, 0);

  const parts = [...chunks, ...central, new Uint8Array(end)].map((chunk) =>
    chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
  );
  return new Blob(parts, { type: "application/zip" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================ Main component ============================ */

export function DashboardClient() {
  return <DashboardInner />;
}

function DashboardInner() {
  const toast = useToast();
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [profileTab, setProfileTab] = useState<ProfileTabKey | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedModelCode, setSelectedModelCode] = useState(defaultBillingModelCode);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [marketplaceSubTab, setMarketplaceSubTab] = useState<MarketplaceSubTab>("subscription");
  const [billingSubTab, setBillingSubTab] = useState<BillingSubTab>("subscription");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [headerProfileOpen, setHeaderProfileOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployConfirmOpen, setDeployConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [rejectConfirm, setRejectConfirm] = useState<{ id: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const speechRecognitionRef = useRef<unknown>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedBillingModel = selectedModelInfo(selectedModelCode);
  const modelSyncInFlightRef = useRef(false);

  const allowedMaxMultiplier = data?.entitlement?.plan?.code
    ? getAllowedMaxMultiplier(data.entitlement.plan.code)
    : Number.POSITIVE_INFINITY;
  const selectedAllowed =
    typeof allowedMaxMultiplier === "number" && selectedBillingModel.multiplier <= allowedMaxMultiplier;

  /* ==== Effects ==== */

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const stored = readStoredThemeMode();
    setThemeMode(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));
  }, []);

  useEffect(() => {
    return () => {
      (speechRecognitionRef.current as { stop?: () => void } | null)?.stop?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      attachments.forEach((attachment) => {
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
      });
    };
  }, [attachments]);

  // Auto-scroll chat to bottom when messages change.
  useEffect(() => {
    if (!chatLogRef.current) return;
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [data?.conversations, conversationId]);

  // Close model menu on outside click.
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (!modelMenuRef.current) return;
      if (event.target instanceof Node && !modelMenuRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [modelMenuOpen]);

  /* ==== API ==== */

  async function loadData() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });

    if (response.status === 401) {
      setAuthRequired(true);
      setLoading(false);
      return;
    }

    if (!response.ok) {
      const errorMessage = await readApiError(response);
      toast.show({ tone: "danger", title: "Failed to load workspace", body: errorMessage });
      setLoading(false);
      return;
    }

    const body = (await response.json()) as AppData;
    setData(body);

    const deployed = body.userAgents.filter((item) => item.status === "DEPLOYED");
    setSelectedAgentIds(deployed.map((item) => item.agentId));

    if (!selectedAgentId && deployed[0]) {
      setSelectedAgentId(deployed[0].agentId);
    }

    if (!conversationId && body.conversations[0]) {
      setConversationId(body.conversations[0].id);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  /* ==== Background poll while any task is in flight ==== */
  // The /api/chat handler now schedules the model call asynchronously and
  // returns RUNNING immediately. We poll for the assistant reply and toast
  // when the task settles so the user sees a clear COMPLETED/FAILED outcome.
  const lastSeenTaskStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!data?.tasks) return;
    const inFlight = data.tasks.filter((t) => t.status === "QUEUED" || t.status === "RUNNING");

    for (const task of data.tasks) {
      const previous = lastSeenTaskStatusRef.current[task.id];
      if (previous && previous !== task.status) {
        if (task.status === "COMPLETED") {
          toast.show({
            tone: "success",
            title: "Task completed",
            body: `${formatNumber(task.tokenCost ?? 0)} token(s) consumed.`,
          });
        } else if (task.status === "FAILED") {
          toast.show({
            tone: "danger",
            title: "Task failed",
            body: task.result?.slice(0, 280) || "The model could not complete this request.",
          });
        }
      }
      lastSeenTaskStatusRef.current[task.id] = task.status;
    }

    if (inFlight.length === 0) return;
    const handle = setInterval(() => {
      void loadData();
    }, 3500);
    return () => clearInterval(handle);
  }, [data?.tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ==== Auto-correct model selection if plan changes ==== */
  useEffect(() => {
    if (!data) return;
    if (selectedAllowed) return;
    const nextAllowed =
      billingModels
        .filter((m) => m.multiplier <= allowedMaxMultiplier)
        .sort((a, b) => b.multiplier - a.multiplier)[0] ?? billingModels[0];
    setSelectedModelCode(nextAllowed.code);
  }, [data?.entitlement?.plan?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ==== Theme toggle (2-state, fixes "double tap" bug) ==== */
  function toggleTheme() {
    const next: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(next);
    persistThemeMode(next);
  }

  /* ==== Chat ==== */

  async function syncModelSelectionToAssistant(nextModelCode: string) {
    if (!data) return;
    const nextModel = billingModels.find((m) => m.code === nextModelCode);
    if (!nextModel) return;
    if (modelSyncInFlightRef.current) return;
    modelSyncInFlightRef.current = true;
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `you are now ${nextModel.brand} ${nextModel.name}. When the user asks "which model are you" or similar, answer with: ${nextModel.brand} ${nextModel.name} (x${nextModel.multiplier}). IMPORTANT: output only the final answer.`,
          agentId: selectedAgentId || undefined,
          conversationId: conversationId || undefined,
          modelCode: nextModelCode,
          silent: true,
        }),
      });
    } finally {
      modelSyncInFlightRef.current = false;
    }
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!prompt.trim() || chatBusy) return;

    if (isRecording) {
      (speechRecognitionRef.current as { stop?: () => void } | null)?.stop?.();
      setIsRecording(false);
      speechRecognitionRef.current = null;
    }

    const attachmentLines = attachments.map((a) => `- ${a.name} (${formatBytes(a.size)})`);
    const promptPayload =
      attachmentLines.length > 0
        ? `${prompt.trim()}\n\nAttached files:\n${attachmentLines.join("\n")}`
        : prompt.trim();

    setChatBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptPayload,
          agentId: selectedAgentId || undefined,
          conversationId: conversationId || undefined,
          modelCode: selectedModelCode,
        }),
      });

      if (!response.ok) {
        const message = await readApiError(response);
        if (response.status === 402 && message.toLowerCase().includes("daily")) {
          toast.show({
            tone: "danger",
            title: "Daily limit reached",
            body: message,
          });
        } else {
          toast.show({ tone: "danger", title: "Could not send", body: message });
        }
        setChatBusy(false);
        return;
      }

      const body = (await response.json()) as {
        status: string;
        task?: { id?: string; tokenCost?: number };
      };
      setPrompt("");
      setAttachments([]);

      if (body.status === "PENDING_APPROVAL") {
        toast.show({
          tone: "warning",
          title: "Approval required",
          body: "This high-risk action is awaiting your approval in Requests.",
        });
      } else if (body.status === "RUNNING" || body.status === "QUEUED") {
        toast.show({
          tone: "info",
          title: "Working on it",
          body: "Your message is queued. The reply will appear here shortly.",
        });
      } else {
        toast.show({
          tone: "success",
          title: "Task completed",
          body: `${formatNumber(body.task?.tokenCost ?? 0)} token(s) consumed.`,
        });
      }

      await loadData();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We could not reach the server. Check your internet connection and try again.";
      toast.show({ tone: "danger", title: "Network error", body: message });
    } finally {
      setChatBusy(false);
    }
  }

  function addAttachments(fileList: FileList | null) {
    if (!fileList) return;
    const maxBytes = 28 * 1024 * 1024;
    const incoming = Array.from(fileList).map((file) => ({
      file,
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      mime: file.type,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    const allowed = incoming.filter((a) => a.size <= maxBytes);
    const rejected = incoming.length - allowed.length;
    if (rejected > 0) {
      toast.show({
        tone: "warning",
        title: "Some files were skipped",
        body: `${rejected} file(s) exceeded ${formatBytes(maxBytes)}.`,
      });
    }
    setAttachments((current) => {
      const next = [...current];
      const existing = new Set(current.map((a) => a.id));
      allowed.forEach((a) => {
        if (!existing.has(a.id)) {
          next.push(a);
          existing.add(a.id);
        }
      });
      return next;
    });
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const next = current.filter((a) => a.id !== id);
      const removed = current.find((a) => a.id === id);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return next;
    });
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }
  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    addAttachments(event.dataTransfer.files);
  }

  function startOrStopRecording() {
    if (!speechSupported) {
      toast.show({ tone: "warning", title: "Voice capture unavailable", body: "Use Chrome or Edge for voice input." });
      return;
    }
    if (isRecording) {
      (speechRecognitionRef.current as { stop?: () => void } | null)?.stop?.();
      setIsRecording(false);
      return;
    }
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new (SpeechRecognition as new () => unknown)() as {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; [0]: { transcript: string } }>;
      }) => void) | null;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: ((error: { error: string }) => void) | null;
      start: () => void;
      stop: () => void;
    };

    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const finals = Array.from({ length: event.results.length - event.resultIndex })
        .map((_, offset) => {
          const r = event.results[event.resultIndex + offset];
          if (!r?.isFinal) return "";
          return r[0]?.transcript ?? "";
        })
        .filter(Boolean)
        .join(" ")
        .trim();
      if (finals) {
        setPrompt((current) => (current ? `${current} ${finals}` : finals).trim());
      }
    };
    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = (error) => {
      toast.show({ tone: "warning", title: "Voice paused", body: error.error });
      setIsRecording(false);
    };
    speechRecognitionRef.current = recognition;
    recognition.start();
  }

  async function createConversation() {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: selectedAgentId || undefined,
        title: "New session",
      }),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Could not create session", body: await readApiError(response) });
      return;
    }
    const body = (await response.json()) as { conversation: Conversation };
    setConversationId(body.conversation.id);
    toast.show({ tone: "success", title: "New chat session ready" });
    await loadData();
  }

  /* ==== Deploy ==== */

  async function deployAgentsConfirmed() {
    if (!data) return;
    setDeployBusy(true);
    try {
      const response = await fetch("/api/agents/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds: selectedNewAgentIds }),
      });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Deploy failed", body: await readApiError(response) });
        return;
      }
      toast.show({
        tone: "success",
        title: "Agents safely deployed",
        body: "Newly selected agents are now available in chat.",
      });
      await loadData();
    } finally {
      setDeployBusy(false);
      setDeployConfirmOpen(false);
    }
  }

  /* ==== Billing ==== */

  async function startCheckout(kind: "SUBSCRIPTION" | "TOKEN_PACK", code: string) {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "SUBSCRIPTION" ? { kind, planCode: code } : { kind, packCode: code }),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Checkout failed", body: await readApiError(response) });
      return;
    }
    const checkout = (await response.json()) as {
      mode: "activated" | "mock" | "razorpay";
      message?: string;
      transactionId?: string;
      orderId?: string;
      amountPaise?: number;
      currency?: string;
      keyId?: string;
    };

    if (checkout.mode === "activated") {
      toast.show({ tone: "success", title: "Plan activated", body: checkout.message });
      await loadData();
      return;
    }

    if (checkout.mode === "mock" && checkout.transactionId) {
      const complete = await fetch("/api/billing/mock-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: checkout.transactionId }),
      });
      if (complete.ok) {
        toast.show({ tone: "success", title: "Mock payment completed" });
      } else {
        toast.show({ tone: "danger", title: "Mock payment failed", body: await readApiError(complete) });
      }
      await loadData();
      return;
    }

    const scriptReady = await loadRazorpayScript();
    const Razorpay = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } })
      .Razorpay;
    if (!scriptReady || !Razorpay || !checkout.keyId || !checkout.orderId || !checkout.transactionId) {
      toast.show({
        tone: "danger",
        title: "Razorpay couldn't open",
        body: "Please check network/browser settings.",
      });
      return;
    }
    const razorpay = new Razorpay({
      key: checkout.keyId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "PineApple",
      description: kind === "SUBSCRIPTION" ? "Subscription plan" : "Token pack",
      order_id: checkout.orderId,
      handler: async (result: Record<string, string>) => {
        const verify = await fetch("/api/billing/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: checkout.transactionId,
            razorpay_order_id: result.razorpay_order_id,
            razorpay_payment_id: result.razorpay_payment_id,
            razorpay_signature: result.razorpay_signature,
          }),
        });
        if (verify.ok) {
          toast.show({ tone: "success", title: "Payment verified", body: "Your account has been updated." });
        } else {
          toast.show({ tone: "danger", title: "Verification failed", body: await readApiError(verify) });
        }
        await loadData();
      },
    });
    razorpay.open();
  }

  /* ==== Approvals ==== */

  async function decideApproval(id: string, decision: "APPROVED" | "REJECTED") {
    const response = await fetch(`/api/requests/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (response.ok) {
      toast.show({
        tone: decision === "APPROVED" ? "success" : "warning",
        title: `Request ${decision.toLowerCase()}`,
      });
    } else {
      toast.show({ tone: "danger", title: "Request action failed", body: await readApiError(response) });
    }
    await loadData();
  }

  /* ==== Notifications ==== */

  async function markNotificationRead(notif: Notification) {
    if (notif.readAt) return;
    const response = await fetch(`/api/notifications/${notif.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      await loadData();
    }
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications/mark-all-read", { method: "POST" });
    if (response.ok) {
      toast.show({ tone: "success", title: "All notifications marked as read" });
      await loadData();
    } else {
      toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
    }
  }

  async function deleteNotification(id: string) {
    const response = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    if (response.ok) {
      await loadData();
    }
  }

  /* ==== Logout ==== */

  async function performLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  /* ==== Render guards ==== */

  if (loading || !data) {
    if (authRequired) {
      return (
        <main className="locked-dashboard-shell">
          <aside className="locked-sidebar" aria-hidden>
            <div className="brand-mark">
              <div className="brand-orb">P</div>
              <div className="brand-text">
                <strong>PineApple</strong>
                <span>Workspace</span>
              </div>
            </div>
            <nav>
              {sidebarTabs.map((tab, index) => {
                const Icon = tab.icon;
                return (
                  <div key={tab.key} className={clsx("nav-item", index === 0 && "active")}>
                    <span className="nav-item-icon">
                      <Icon size={18} strokeWidth={1.75} />
                    </span>
                    <span className="nav-item-label">{tab.label}</span>
                  </div>
                );
              })}
            </nav>
          </aside>
          <section className="locked-main">
            <div className="locked-chat-preview">
              <div className="chat-hero">
                <div className="chat-hero-icon">
                  <Bot size={40} strokeWidth={1.25} />
                </div>
                <h2>Where should we begin?</h2>
              </div>
              <div className="locked-input-preview">
                <Paperclip size={18} />
                <span>Ask PineApple anything...</span>
                <Mic size={18} />
                <button type="button" aria-label="Send">
                  <Send size={15} />
                </button>
              </div>
            </div>
            <div className="locked-auth-card">
              <div className="eyebrow">Authentication required</div>
              <h1>Sign in with Google to use the workspace.</h1>
              <p>
                You can view the dashboard shell, but chat, marketplace actions, billing, and approvals unlock after
                authentication.
              </p>
              <AuthPanel compact />
            </div>
          </section>
        </main>
      );
    }
    return (
      <main className="dashboard-loading">
        <div className="spinner-lg" aria-hidden />
        <span>Preparing your PineApple workspace…</span>
      </main>
    );
  }

  // Admins use a dedicated console — no chat, no marketplace, no user-side
  // features. The admin's role is to monitor and control, not to participate.
  if (data.user.role === "ADMIN") {
    return (
      <AdminConsole
        user={data.user}
        themeMode={themeMode}
        toggleTheme={toggleTheme}
        onRequestLogout={() => setLogoutConfirmOpen(true)}
        logoutConfirmOpen={logoutConfirmOpen}
        setLogoutConfirmOpen={setLogoutConfirmOpen}
        performLogout={performLogout}
      />
    );
  }

  /* ==== Derived state ==== */

  // Hide agent-deployed notifications from global feed; they are surface=marketplace.
  const globalNotifications = data.notifications.filter((n) => (n.surface ?? "global") === "global");
  const marketplaceNotifications = data.notifications.filter((n) => (n.surface ?? "global") === "marketplace");
  const unreadGlobal = globalNotifications.filter((n) => !n.readAt).length;

  const deployedAgents = data.userAgents.filter((item) => item.status === "DEPLOYED");
  const deployedAgentIds = deployedAgents.map((item) => item.agentId);
  const selectedNewAgentIds = selectedAgentIds.filter((id) => !deployedAgentIds.includes(id));
  const selectedNewAgents = data.agents.filter((agent) => selectedNewAgentIds.includes(agent.id));
  const selectedConversation = data.conversations.find((item) => item.id === conversationId);
  const pendingApprovals = data.approvals.filter((a) => a.status === "PENDING");
  const monthlyCap = data.entitlement.plan.monthlyTokens;
  const subRem = data.wallet?.subscriptionTokensRemaining ?? 0;
  const purRem = data.wallet?.purchasedTokensRemaining ?? 0;
  const usedSub = monthlyCap > 0 ? Math.max(0, monthlyCap - subRem) : 0;
  const tokenBarPct = monthlyCap > 0 ? Math.min(100, (usedSub / monthlyCap) * 100) : 0;
  const capLabel = monthlyCap > 0 ? formatTokenShort(monthlyCap) : "∞";
  const lowFuel = monthlyCap > 0 && subRem / monthlyCap < 0.1;
  const maxAgentSlots = data.entitlement.plan.maxAgents >= 999 ? 99 : data.entitlement.plan.maxAgents;
  const freeSlots = Math.max(0, maxAgentSlots - deployedAgents.length);

  const planBadge =
    data.entitlement.plan.code === "free"
      ? "Free"
      : data.entitlement.plan.code === "pro" || data.entitlement.plan.code === "professional"
      ? "Pro"
      : data.entitlement.plan.name.split(" ")[0] ?? data.entitlement.plan.name;

  const taskStats = {
    total: data.tasks.length,
    completed: data.tasks.filter((t) => t.status === "COMPLETED").length,
    pendingExec: data.tasks.filter((t) => t.status === "QUEUED" || t.status === "RUNNING").length,
    needApproval: data.tasks.filter((t) => t.status === "PENDING_APPROVAL").length,
    rejected: data.tasks.filter((t) => t.status === "REJECTED" || t.status === "FAILED").length,
  };

  /* ==== Profile menu items ==== */

  const profileMenuItems: ProfileMenuItem[] = [
    {
      id: "profile",
      label: "My Profile",
      icon: UserIcon,
      onSelect: () => {
        setProfileTab("profile");
        setShowAdmin(false);
      },
    },
    {
      id: "billing",
      label: "Billing",
      icon: CreditCard,
      onSelect: () => {
        setProfileTab("billing");
        setShowAdmin(false);
      },
    },
    {
      id: "logs",
      label: "Logs",
      icon: TerminalSquare,
      onSelect: () => {
        setProfileTab("logs");
        setShowAdmin(false);
      },
    },
    {
      id: "live",
      label: "Live Status",
      icon: Activity,
      onSelect: () => {
        setProfileTab("live");
        setShowAdmin(false);
      },
    },
    {
      id: "logout",
      label: "Log out",
      icon: LogOut,
      danger: true,
      onSelect: () => setLogoutConfirmOpen(true),
    },
  ];

  /* ==== Render ==== */

  return (
    <main className="dashboard-shell">
      {/* ============ Sidebar ============ */}
      <aside className="sidebar">
        <div className="brand-mark">
          <div className="brand-orb" aria-hidden>
            P
          </div>
          <div className="brand-text">
            <strong>PineApple</strong>
            <span>Workspace</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {sidebarTabs.map((tab) => {
            const Icon = tab.icon;
            const showBadge =
              (tab.badge === "requests" && pendingApprovals.length > 0) ||
              (tab.badge === "notifications" && unreadGlobal > 0);
            const count =
              tab.badge === "requests" ? pendingApprovals.length : tab.badge === "notifications" ? unreadGlobal : 0;
            const isActive = activeTab === tab.key && !showAdmin && profileTab === null;
            return (
              <button
                key={tab.key}
                type="button"
                className={clsx("nav-item", isActive && "active")}
                onClick={() => {
                  if (tab.key === "marketplace") setMarketplaceSubTab("subscription");
                  setActiveTab(tab.key);
                  setProfileTab(null);
                  setShowAdmin(false);
                }}
              >
                <span className="nav-item-icon" aria-hidden>
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="nav-item-label">{tab.label}</span>
                {showBadge && <em>{count > 9 ? "9+" : count}</em>}
              </button>
            );
          })}
        </nav>

        {/* ===== Footer: token meter + profile popover trigger ===== */}
        <div className="sidebar-footer">
          {lowFuel && (
            <div className="notice danger" style={{ margin: 0, fontSize: "0.8rem", padding: "8px 10px" }}>
              <strong>Low fuel!</strong> Top up tokens or upgrade your plan.
            </div>
          )}

          <div className={clsx("token-meter", lowFuel && "token-meter--danger")}>
            <div className="token-meter-label">
              <span>Tokens</span>
              <span>
                {formatTokenShort(usedSub)} / {capLabel}
              </span>
            </div>
            <div className="token-meter-bar" aria-hidden>
              {monthlyCap > 0 ? (
                <div className="token-meter-fill" style={{ width: `${tokenBarPct}%` }} />
              ) : (
                <div className="token-meter-fill" style={{ width: "100%", opacity: 0.6 }} />
              )}
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setProfilePopoverOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={profilePopoverOpen}
            >
              <div className="sidebar-avatar" aria-hidden>
                {userInitials(data.user.name)}
              </div>
              <div className="profile-trigger-meta">
                <span className="profile-trigger-name">{data.user.name}</span>
                <span className="profile-trigger-plan">
                  <Sparkles size={11} /> {planBadge}
                </span>
              </div>
              <ChevronUp size={16} style={{ color: "var(--muted)" }} />
            </button>

            <ProfilePopover
              open={profilePopoverOpen}
              onClose={() => setProfilePopoverOpen(false)}
              anchor="bottom-left"
              user={{ name: data.user.name, email: data.user.email }}
              items={profileMenuItems}
            />
          </div>
        </div>
      </aside>

      {/* ============ Main panel ============ */}
      <section className="main-panel">
        {/* ===== Header ===== */}
        {activeTab === "chat" && profileTab === null && !showAdmin && (
          <header className="main-header main-header-chat">
            <div className="assistant-select-wrap" aria-label="Active assistant">
              <MessageSquareText size={16} />
              <span className="chat-codepilot-label">Agent</span>
              <select
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                aria-label="Choose assistant"
              >
                {deployedAgents.length === 0 && <option value="">No deployed agents</option>}
                {deployedAgents.map((item) => (
                  <option key={item.agentId} value={item.agentId}>
                    {item.agent.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} style={{ color: "var(--muted)" }} />
            </div>
            <div className="session-select-wrap" aria-label="Active session">
              <Clock size={14} style={{ color: "var(--muted)" }} />
              <span className="chat-session-label">Session</span>
              <select
                value={conversationId || "__new__"}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === "__new__") {
                    void createConversation();
                  } else {
                    setConversationId(next);
                  }
                }}
                aria-label="Choose chat session"
              >
                <option value="__new__">New session</option>
                {data.conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} style={{ color: "var(--muted)" }} />
            </div>
            <span className="live-pill">Live</span>
            <div style={{ flex: 1 }} />
            <HeaderRight
              themeMode={themeMode}
              toggleTheme={toggleTheme}
              userName={data.user.name}
              user={data.user}
              menuItems={profileMenuItems}
              open={headerProfileOpen}
              setOpen={setHeaderProfileOpen}
            />
          </header>
        )}

        {(activeTab !== "chat" || profileTab !== null || showAdmin) && (
          <header className="main-header">
            <div>
              <h1 className="page-title">
                {showAdmin
                  ? "Admin Console"
                  : profileTab === "profile"
                  ? "My Profile"
                  : profileTab === "logs"
                  ? "System Logs"
                  : profileTab === "billing"
                  ? "Billing"
                  : profileTab === "live"
                  ? "Live Status"
                  : activeTab === "myAgents"
                  ? "My Agents"
                  : activeTab === "marketplace"
                  ? "Marketplace"
                  : activeTab === "connectors"
                  ? "Connectors"
                  : activeTab === "notifications"
                  ? "Notifications"
                  : activeTab === "request"
                  ? "Approval Requests"
                  : activeTab === "tasks"
                  ? "Tasks"
                  : ""}
              </h1>
              <p className="page-subtitle">
                {showAdmin && "Manage users, plans, token packs, and audit the platform."}
                {profileTab === "profile" && "Update your profile and security settings."}
                {profileTab === "logs" && "Live, terminal-style audit log of your account activity."}
                {profileTab === "billing" && "View subscription, top up tokens, and inspect transactions."}
                {profileTab === "live" && "Real-time signal of your wallet, agents, and tasks."}
                {profileTab === null && activeTab === "myAgents" && (
                  <>
                    <strong>{deployedAgents.length}</strong> of {maxAgentSlots} agents deployed.{" "}
                    <span style={{ color: "var(--success)", fontWeight: 700 }}>{freeSlots} slots open.</span>
                  </>
                )}
                {profileTab === null && activeTab === "marketplace" && "Subscribe to plans, top up tokens, or deploy agents."}
                {profileTab === null && activeTab === "connectors" && ""}
                {profileTab === null && activeTab === "notifications" && (
                  <>
                    {unreadGlobal} unread {unreadGlobal === 1 ? "notification" : "notifications"}
                  </>
                )}
                {profileTab === null && activeTab === "request" && "Review and approve high-risk agent actions."}
                {profileTab === null && activeTab === "tasks" && "Track every task your agents have run."}
              </p>
            </div>
            <HeaderRight
              themeMode={themeMode}
              toggleTheme={toggleTheme}
              userName={data.user.name}
              user={data.user}
              menuItems={profileMenuItems}
              open={headerProfileOpen}
              setOpen={setHeaderProfileOpen}
            />
          </header>
        )}

        {/* ============ Content ============ */}

        {/* Admin users render an entirely separate console (handled above). */}

        {/* Profile sub-tabs */}
        {!showAdmin && profileTab === "profile" && <ProfileTab user={data.user} onSaved={loadData} />}
        {!showAdmin && profileTab === "logs" && <LogsTerminal logs={data.logs} />}
        {!showAdmin && profileTab === "billing" && (
          <BillingPanel
            data={data}
            subTab={billingSubTab}
            setSubTab={setBillingSubTab}
            startCheckout={startCheckout}
          />
        )}
        {!showAdmin && profileTab === "live" && <LiveStatusPanel data={data} />}

        {/* Main tabs */}
        {!showAdmin && profileTab === null && activeTab === "chat" && (
          <ChatTab
            data={data}
            conversationId={conversationId}
            setConversationId={setConversationId}
            createConversation={createConversation}
            selectedConversation={selectedConversation}
            chatLogRef={chatLogRef}
            chatBusy={chatBusy}
            sendPrompt={sendPrompt}
            prompt={prompt}
            setPrompt={setPrompt}
            attachments={attachments}
            removeAttachment={removeAttachment}
            openFilePicker={openFilePicker}
            fileInputRef={fileInputRef}
            addAttachments={addAttachments}
            handleDragOver={handleDragOver}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            isDragOver={isDragOver}
            startOrStopRecording={startOrStopRecording}
            isRecording={isRecording}
            speechSupported={speechSupported}
            modelMenuOpen={modelMenuOpen}
            setModelMenuOpen={setModelMenuOpen}
            modelMenuRef={modelMenuRef}
            selectedModelCode={selectedModelCode}
            setSelectedModelCode={setSelectedModelCode}
            syncModelSelectionToAssistant={syncModelSelectionToAssistant}
            allowedMaxMultiplier={allowedMaxMultiplier}
          />
        )}

        {!showAdmin && profileTab === null && activeTab === "myAgents" && (
          <MyAgentsTab
            deployedAgents={deployedAgents}
            onChat={(agentId) => {
              setSelectedAgentId(agentId);
              setActiveTab("chat");
              toast.show({ tone: "info", title: "Agent selected", body: "You can chat with this agent now." });
            }}
          />
        )}

        {!showAdmin && profileTab === null && activeTab === "marketplace" && (
          <MarketplaceTab
            data={data}
            subTab={marketplaceSubTab}
            setSubTab={setMarketplaceSubTab}
            startCheckout={startCheckout}
            selectedAgentIds={selectedAgentIds}
            setSelectedAgentIds={setSelectedAgentIds}
            maxAgentSlots={maxAgentSlots}
            freeSlots={freeSlots}
            deployedAgentIds={deployedAgentIds}
            selectedNewAgentIds={selectedNewAgentIds}
            onDeploy={() => {
              if (selectedNewAgentIds.length === 0) {
                toast.show({ tone: "danger", title: "Select at least one new agent" });
                return;
              }
              setDeployConfirmOpen(true);
            }}
            deployBusy={deployBusy}
            tokenBarPct={tokenBarPct}
            usedSub={usedSub}
            monthlyCap={monthlyCap}
            subRem={subRem}
            marketplaceNotifications={marketplaceNotifications}
            onMarkRead={markNotificationRead}
          />
        )}

        {!showAdmin && profileTab === null && activeTab === "connectors" && (
          <section className="connectors-placeholder">
            <span className="badge-coming-soon">
              <Plug size={14} /> Coming soon
            </span>
            <h2 className="page-title" style={{ fontSize: "1.4rem" }}>
              Connectors
            </h2>
          </section>
        )}

        {!showAdmin && profileTab === null && activeTab === "notifications" && (
          <NotificationsTab
            notifications={globalNotifications}
            onMarkAllRead={markAllRead}
            onMarkRead={markNotificationRead}
            onDelete={deleteNotification}
          />
        )}

        {!showAdmin && profileTab === null && activeTab === "request" && (
          <RequestsTab
            approvals={data.approvals}
            onApprove={(id) => decideApproval(id, "APPROVED")}
            onReject={(id) => setRejectConfirm({ id })}
          />
        )}

        {!showAdmin && profileTab === null && activeTab === "tasks" && (
          <TasksTab tasks={data.tasks} stats={taskStats} />
        )}
      </section>

      {/* ===== Confirm Modals ===== */}
      <ConfirmModal
        open={deployConfirmOpen}
        title="Safely deploy agents?"
        description={
          <div className="deploy-confirm-copy">
            <p>
              We'll deploy {selectedNewAgents.length} new agent{selectedNewAgents.length === 1 ? "" : "s"} into your
              chat workspace.
            </p>
            <ul>
              {selectedNewAgents.map((agent) => (
                <li key={agent.id}>
                  <strong>{agent.name}</strong>
                  <span>
                    {agent.category} · {agent.riskLevel.toLowerCase()} risk
                  </span>
                </li>
              ))}
            </ul>
            <p className="modal-caution">
              These agents can run tasks on your behalf. High-risk actions still pause for approval before execution.
            </p>
          </div>
        }
        confirmLabel={deployBusy ? "Deploying..." : "Deploy"}
        cancelLabel="Not now"
        tone="info"
        loading={deployBusy}
        onConfirm={deployAgentsConfirmed}
        onCancel={() => setDeployConfirmOpen(false)}
      />

      <ConfirmModal
        open={logoutConfirmOpen}
        title="Log out?"
        description="You'll need to sign in again to use PineApple."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        tone="danger"
        onConfirm={performLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />

      <ConfirmModal
        open={Boolean(rejectConfirm)}
        title="Reject this request?"
        description="The high-risk action will be cancelled and removed from the queue."
        confirmLabel="Reject"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={async () => {
          if (rejectConfirm) await decideApproval(rejectConfirm.id, "REJECTED");
          setRejectConfirm(null);
        }}
        onCancel={() => setRejectConfirm(null)}
      />
    </main>
  );
}

/* ============================ Header right (theme toggle + avatar with popover) ============================ */
function HeaderRight({
  themeMode,
  toggleTheme,
  userName,
  user,
  menuItems,
  open,
  setOpen,
}: {
  themeMode: ThemeMode;
  toggleTheme: () => void;
  userName: string;
  user: { name: string; email: string };
  menuItems: ProfileMenuItem[];
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <div className="main-header-right">
      <button className="icon-button" type="button" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
        {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="header-avatar"
          onClick={() => setOpen(!open)}
          title={userName}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {userInitials(userName).slice(0, 1)}
        </button>
        <ProfilePopover open={open} onClose={() => setOpen(false)} anchor="top-right" user={user} items={menuItems} />
      </div>
    </div>
  );
}

/* ============================ Chat Tab ============================ */

function ChatTab(props: {
  data: AppData;
  conversationId: string;
  setConversationId: (v: string) => void;
  createConversation: () => void;
  selectedConversation: Conversation | undefined;
  chatLogRef: React.RefObject<HTMLDivElement | null>;
  chatBusy: boolean;
  sendPrompt: (event: FormEvent<HTMLFormElement>) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  attachments: ChatAttachment[];
  removeAttachment: (id: string) => void;
  openFilePicker: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addAttachments: (fl: FileList | null) => void;
  handleDragOver: (e: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: DragEvent<HTMLDivElement>) => void;
  isDragOver: boolean;
  startOrStopRecording: () => void;
  isRecording: boolean;
  speechSupported: boolean;
  modelMenuOpen: boolean;
  setModelMenuOpen: (v: boolean) => void;
  modelMenuRef: React.RefObject<HTMLDivElement | null>;
  selectedModelCode: string;
  setSelectedModelCode: (v: string) => void;
  syncModelSelectionToAssistant: (code: string) => Promise<void>;
  allowedMaxMultiplier: number;
}) {
  const {
    data,
    conversationId,
    setConversationId,
    createConversation,
    selectedConversation,
    chatLogRef,
    chatBusy,
    sendPrompt,
    prompt,
    setPrompt,
    attachments,
    removeAttachment,
    openFilePicker,
    fileInputRef,
    addAttachments,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isDragOver,
    startOrStopRecording,
    isRecording,
    speechSupported,
    modelMenuOpen,
    setModelMenuOpen,
    modelMenuRef,
    selectedModelCode,
    setSelectedModelCode,
    syncModelSelectionToAssistant,
    allowedMaxMultiplier,
  } = props;

  const selectedModel = selectedModelInfo(selectedModelCode);

  return (
    <div className="chat-layout chat-layout--full">
      {/* ===== Chat card ===== */}
      <div className="chat-card">
        <div
          className="chat-log"
          ref={chatLogRef}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={isDragOver ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
        >
          {(selectedConversation?.messages ?? []).length === 0 && (
            <div className="chat-hero">
              <div className="chat-hero-icon">
                <Bot size={40} strokeWidth={1.25} />
              </div>
              <h2>How can I help you today?</h2>
              <p>Ask anything — code, research, drafts. Attach files, change models, speak — all in one input.</p>
            </div>
          )}
          {selectedConversation?.messages.map((item) => {
            const parsed = item.role === "ASSISTANT" ? parseProjectArtifact(item.content) : null;
            return (
              <article
                key={item.id}
                className={clsx("bubble", item.role.toLowerCase(), parsed?.artifact && "project-bubble")}
              >
                <span>{item.role === "ASSISTANT" ? "PineApple" : item.role}</span>
                {parsed?.artifact ? (
                  <ProjectArtifactCard intro={parsed.intro} artifact={parsed.artifact} />
                ) : (
                  <p>{item.content}</p>
                )}
                {item.role === "ASSISTANT" && typeof item.tokenEstimate === "number" && item.tokenEstimate > 0 && (
                  <small>Tokens: {formatNumber(item.tokenEstimate)}</small>
                )}
              </article>
            );
          })}
          {chatBusy && (
            <article className="bubble assistant" aria-live="polite">
              <span>PineApple</span>
              <p>
                <span className="terminal-cursor" /> thinking…
              </p>
            </article>
          )}
        </div>

        {/* ===== Single chat input row (Gemini/ChatGPT style) ===== */}
        <form onSubmit={sendPrompt}>
          <div className="chat-input-shell">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(event) => {
                addAttachments(event.target.files);
                event.currentTarget.value = "";
              }}
            />

            {attachments.length > 0 && (
              <div className="chat-attachments">
                {attachments.map((a) => (
                  <span key={a.id} className="chat-attachment-chip">
                    <FileText size={13} />
                    <strong>{a.name}</strong>
                    <small>· {formatBytes(a.size)}</small>
                    <button type="button" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="chat-input-row">
              <div className="chat-tools-left">
                <button
                  type="button"
                  className="chat-tool-btn"
                  onClick={openFilePicker}
                  title="Attach files"
                  aria-label="Attach files"
                >
                  <Paperclip size={18} />
                </button>
                <button
                  type="button"
                  className={clsx("chat-tool-btn", isRecording && "recording")}
                  onClick={startOrStopRecording}
                  disabled={!speechSupported && !isRecording}
                  title={isRecording ? "Stop voice input" : "Voice input"}
                  aria-label={isRecording ? "Stop voice input" : "Voice input"}
                >
                  {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              </div>

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask PineApple anything…"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).form?.requestSubmit();
                  }
                }}
              />

              <div className="chat-tools-right">
                <div ref={modelMenuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="chat-model-pick"
                    onClick={() => setModelMenuOpen(!modelMenuOpen)}
                    title="Choose model"
                  >
                    <Zap size={13} />
                    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1, gap: 1 }}>
                      <span style={{ fontWeight: 700, fontSize: "0.78rem" }}>
                        {selectedModel.brand} {selectedModel.name}
                      </span>
                    </span>
                    <ChevronDown size={12} />
                  </button>
                  {modelMenuOpen && (
                    <div className="chat-model-menu" role="menu">
                      {billingModels.map((m) => {
                        const disabled = m.multiplier > allowedMaxMultiplier;
                        return (
                          <button
                            key={m.code}
                            type="button"
                            className={clsx("chat-model-menu-item", m.code === selectedModelCode && "active")}
                            disabled={disabled}
                            onClick={async () => {
                              setSelectedModelCode(m.code);
                              setModelMenuOpen(false);
                              await syncModelSelectionToAssistant(m.code);
                            }}
                          >
                            <div>
                              <strong>
                                {m.brand} {m.name}
                              </strong>
                              <small>
                                {m.output}
                                {disabled ? " · upgrade required" : ""}
                              </small>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="chat-send-btn"
                  title="Send"
                  aria-label="Send"
                  disabled={chatBusy || !prompt.trim()}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
          <p className="chat-disclaimer">
            PineApple may make mistakes. Verify important information. Drag files anywhere on the chat to attach.
          </p>
        </form>
      </div>
    </div>
  );
}

function ProjectArtifactCard({ intro, artifact }: { intro: string; artifact: ProjectArtifact }) {
  const [activePath, setActivePath] = useState(artifact.entry ?? artifact.files[0]?.path ?? "");
  const activeFile = artifact.files.find((file) => file.path === activePath) ?? artifact.files[0];
  const folders = useMemo(() => {
    const names = new Set<string>();
    for (const file of artifact.files) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        names.add(parts.slice(0, i).join("/"));
      }
    }
    return names;
  }, [artifact.files]);

  function preview() {
    const html = buildPreviewHtml(artifact);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadZip() {
    downloadBlob(createZipBlob(artifact.files), `${safeProjectName(artifact.name)}.zip`);
  }

  return (
    <div className="project-artifact">
      {intro && <p className="project-artifact-intro">{intro}</p>}
      <div className="project-workspace">
        <div className="project-toolbar">
          <div>
            <strong>{artifact.name}</strong>
            <span>{artifact.files.length} files</span>
          </div>
          <div className="project-actions">
            <button type="button" className="project-action-btn" onClick={preview}>
              <Eye size={15} /> Preview
            </button>
            <button type="button" className="project-action-btn primary" onClick={downloadZip}>
              <Download size={15} /> Download ZIP
            </button>
          </div>
        </div>
        <div className="project-body">
          <aside className="project-tree">
            {[...folders].sort().map((folder) => (
              <div key={folder} className="project-tree-folder">
                <Folder size={14} />
                <span>{folder}</span>
              </div>
            ))}
            {artifact.files.map((file) => (
              <button
                type="button"
                key={file.path}
                className={clsx("project-tree-file", file.path === activeFile?.path && "active")}
                onClick={() => setActivePath(file.path)}
              >
                <FileCode2 size={14} />
                <span>{file.path}</span>
              </button>
            ))}
          </aside>
          <section className="project-code-panel">
            {activeFile ? (
              <>
                <div className="project-code-head">
                  <FileText size={14} />
                  <strong>{activeFile.path}</strong>
                </div>
                <pre>{activeFile.content}</pre>
              </>
            ) : (
              <div className="project-empty">No content</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ============================ My Agents Tab ============================ */

function MyAgentsTab({
  deployedAgents,
  onChat,
}: {
  deployedAgents: UserAgent[];
  onChat: (agentId: string) => void;
}) {
  if (deployedAgents.length === 0) {
    return (
      <div className="empty-state">
        <Bot size={56} strokeWidth={1.2} />
        <strong style={{ fontSize: "1.1rem" }}>No agents deployed yet</strong>
        <p style={{ maxWidth: 360, color: "var(--muted)" }}>
          Deploy agents from the Marketplace to chat with them and run tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="agent-grid">
      {deployedAgents.map((item) => (
        <article key={item.id} className="agent-card selected" style={{ cursor: "default" }}>
          <div className="agent-card-head">
            <div className="agent-icon">{userInitials(item.agent.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="agent-card-cat">{item.agent.category}</div>
              <div className="agent-card-title">{item.agent.name}</div>
            </div>
          </div>
          <p>{item.agent.description}</p>
          <ul className="agent-caps">
            {agentCapabilities(item.agent).map((line) => (
              <li key={line}>
                <Check size={14} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="agent-card-foot">
            <span className={`risk-badge ${item.agent.riskLevel}`}>
              <Shield size={11} /> {item.agent.riskLevel} risk
            </span>
            <span className="badge badge-ok" style={{ fontSize: "0.7rem" }}>
              Online
            </span>
          </div>
          <button type="button" className="btn btn-primary my-agent-card-cta" onClick={() => onChat(item.agentId)}>
            <MessageSquareText size={14} /> Chat
          </button>
        </article>
      ))}
    </div>
  );
}

/* ============================ Marketplace Tab ============================ */

function MarketplaceTab(props: {
  data: AppData;
  subTab: MarketplaceSubTab;
  setSubTab: (v: MarketplaceSubTab) => void;
  startCheckout: (kind: "SUBSCRIPTION" | "TOKEN_PACK", code: string) => Promise<void>;
  selectedAgentIds: string[];
  setSelectedAgentIds: (updater: (prev: string[]) => string[]) => void;
  maxAgentSlots: number;
  freeSlots: number;
  deployedAgentIds: string[];
  selectedNewAgentIds: string[];
  onDeploy: () => void;
  deployBusy: boolean;
  tokenBarPct: number;
  usedSub: number;
  monthlyCap: number;
  subRem: number;
  marketplaceNotifications: Notification[];
  onMarkRead: (n: Notification) => void;
}) {
  const {
    data,
    subTab,
    setSubTab,
    startCheckout,
    selectedAgentIds,
    setSelectedAgentIds,
    maxAgentSlots,
    freeSlots,
    deployedAgentIds,
    selectedNewAgentIds,
    onDeploy,
    deployBusy,
    tokenBarPct,
    usedSub,
    monthlyCap,
    subRem,
    marketplaceNotifications,
    onMarkRead,
  } = props;

  const popularPlanCode = "pro";

  return (
    <section className="market-stack">
      <div className="marketplace-tabs" role="tablist">
        <button
          type="button"
          className={clsx(subTab === "subscription" && "active")}
          onClick={() => setSubTab("subscription")}
        >
          <CreditCard size={14} /> Subscription
        </button>
        <button type="button" className={clsx(subTab === "tokens" && "active")} onClick={() => setSubTab("tokens")}>
          <Coins size={14} /> Tokens
        </button>
        <button type="button" className={clsx(subTab === "agents" && "active")} onClick={() => setSubTab("agents")}>
          <Bot size={14} /> Agents
        </button>
      </div>

      {/* Marketplace-scoped notifications (e.g. agent deployed) */}
      {marketplaceNotifications.length > 0 && (
        <div className="workspace-card" style={{ padding: 16 }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="eyebrow">Recent activity</div>
              <h2 style={{ fontSize: "1rem" }}>Marketplace updates</h2>
            </div>
          </div>
          {marketplaceNotifications.slice(0, 3).map((n) => (
            <div
              key={n.id}
              className={clsx("notification-row", !n.readAt && "is-unread")}
              onClick={() => onMarkRead(n)}
              style={{ cursor: "pointer" }}
            >
              <div className="icon-wrap">
                <Rocket size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{n.title}</strong>
                <span className="body">{n.body}</span>
              </div>
              <span className="time">{formatRelativeTime(n.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ===== Subscription ===== */}
      {subTab === "subscription" && (
        <div className="plan-grid">
          {data.plans.map((plan) => {
            const isCurrent = plan.code === data.entitlement.plan.code;
            const isPopular = plan.code === popularPlanCode && !isCurrent;
            return (
              <article key={plan.id} className={clsx("plan-card", isPopular && "popular", isCurrent && "current")}>
                {isPopular && <span className="plan-popular-badge">Most popular</span>}
                {isCurrent && <span className="plan-current-badge">Current</span>}
                <div className={`plan-tone-bar ${planTone(plan.code)}`} />
                <div className="plan-card-head">
                  <span className="plan-name">{plan.name}</span>
                </div>
                <div className="plan-price">
                  {plan.isCustom ? (
                    "Talk to us"
                  ) : (
                    <>
                      {formatMoney(plan.monthlyPriceInr)}{" "}
                      <span className="plan-price-period">/mo</span>
                    </>
                  )}
                </div>
                <div className="plan-feature">
                  <Check size={14} className="check" />
                  <span>
                    <strong>{formatNumber(plan.monthlyTokens)}</strong> monthly tokens
                  </span>
                </div>
                <div className="plan-feature">
                  <Check size={14} className="check" />
                  <span>
                    {plan.maxAgents >= 999 ? "Unlimited" : plan.maxAgents} deployed agents
                  </span>
                </div>
                <div className="plan-feature">
                  <Check size={14} className="check" />
                  <span>Multi-model access by plan tier</span>
                </div>
                <div className={`plan-feature${plan.code === "free" ? " plan-feature--muted" : ""}`}>
                  <Check size={14} className="check" />
                  <span>{plan.code === "free" ? "Community support" : "Priority support"}</span>
                </div>
                <div className="plan-cta">
                  <button
                    type="button"
                    className={clsx("btn", "btn-block", isCurrent ? "btn-soft" : isPopular ? "btn-accent" : "btn-primary")}
                    disabled={plan.isCustom || isCurrent}
                    onClick={() => startCheckout("SUBSCRIPTION", plan.code)}
                  >
                    {isCurrent ? "Current plan" : plan.isCustom ? "Talk to sales" : "Subscribe"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ===== Tokens ===== */}
      {subTab === "tokens" && (
        <div>
          <div className="token-balance-card">
            <div>
              <h2>Token balance</h2>
              <p className="fine-print">
                {formatTokenShort(usedSub)} used of {monthlyCap > 0 ? formatTokenShort(monthlyCap) : "plan total"} — used{" "}
                {Math.round(tokenBarPct)}% this period
              </p>
              <div className="token-meter token-balance-bar">
                <div className="token-meter-bar">
                  <div className="token-meter-fill" style={{ width: `${tokenBarPct}%` }} />
                </div>
              </div>
            </div>
            <div className="token-balance-metric">{formatTokenShort(subRem)}</div>
          </div>

          <div className="pack-row">
            {data.tokenPacks.map((pack) => {
              const featured = pack.tokens >= 800_000 && pack.tokens <= 1_500_000;
              return (
                <article key={pack.id} className={clsx("pack-card", featured && "pack-card-featured")}>
                  {featured && <span className="pack-feature-badge">Best value</span>}
                  <div className="pack-icon">
                    <Coins size={20} />
                  </div>
                  <strong className="pack-name">{pack.name}</strong>
                  <div className="pack-tokens">{formatNumber(pack.tokens)}</div>
                  <div className="pack-rate">
                    <strong>tokens</strong> · {ratePerOneThousand(pack.priceInr, pack.tokens)}
                  </div>
                  <div className="pack-cta">
                    <button
                      type="button"
                      className={clsx("btn btn-block", featured ? "btn-accent" : "btn-primary")}
                      disabled={data.entitlement.plan.code === "free"}
                      onClick={() => startCheckout("TOKEN_PACK", pack.code)}
                    >
                      {data.entitlement.plan.code === "free" ? "Upgrade first" : `Buy for ${formatMoney(pack.priceInr)}`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Agents ===== */}
      {subTab === "agents" && (
        <div>
          <div className="deploy-banner">
            <div>
              <p className="fine-print" style={{ margin: 0 }}>
                Your plan: <strong>{data.entitlement.plan.name}</strong>
              </p>
              <p style={{ margin: "6px 0 0", fontWeight: 600 }}>
                Select up to {maxAgentSlots} agents · {freeSlots} slot{freeSlots === 1 ? "" : "s"} remaining
              </p>
            </div>
            <div className="deploy-banner-actions">
              <span className="fine-print">
                {selectedNewAgentIds.length} new · {selectedAgentIds.length} / {maxAgentSlots} selected
              </span>
              <button
                type="button"
                className={clsx("btn-deploy", deployBusy && "loading")}
                disabled={deployBusy || selectedNewAgentIds.length === 0}
                onClick={onDeploy}
              >
                {deployBusy ? <span className="spinner" aria-hidden /> : <Rocket size={14} />}
                {deployBusy ? "Deploying…" : "Deploy agents"}
              </button>
            </div>
          </div>

          <div className="agent-grid">
            {data.agents.map((agent) => {
              const locked = data.entitlement.plan.code === "free" && !agent.isDefault;
              const deployed = deployedAgentIds.includes(agent.id);
              const checked = selectedAgentIds.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={clsx("agent-card", checked && "selected", locked && "locked", deployed && "deployed")}
                  onClick={() => {
                    if (locked || deployed) return;
                    setSelectedAgentIds((current) =>
                      checked ? current.filter((id) => id !== agent.id) : [...current, agent.id],
                    );
                  }}
                >
                  <div className="agent-card-checkbox" aria-hidden>
                    {checked ? <Check size={14} /> : null}
                  </div>
                  <div className="agent-card-head">
                    <div className="agent-icon">{userInitials(agent.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="agent-card-cat">{agent.category}</div>
                      <div className="agent-card-title">{agent.name}</div>
                    </div>
                  </div>
                  <p>{agent.description}</p>
                  <ul className="agent-caps">
                    {agentCapabilities(agent)
                      .slice(0, 3)
                      .map((line) => (
                        <li key={line}>
                          <Check size={14} />
                          <span>{line}</span>
                        </li>
                      ))}
                  </ul>
                  <div className="agent-card-foot">
                    <span className={`risk-badge ${agent.riskLevel}`}>
                      <Shield size={11} /> {agent.riskLevel} risk
                    </span>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: locked ? "var(--muted)" : "var(--ink)" }}>
                      {locked ? "Upgrade to deploy" : deployed ? "Deployed" : checked ? "Selected" : "Tap to select"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================ Notifications Tab ============================ */

function NotificationsTab({
  notifications,
  onMarkAllRead,
  onMarkRead,
  onDelete,
}: {
  notifications: Notification[];
  onMarkAllRead: () => void;
  onMarkRead: (n: Notification) => void;
  onDelete: (id: string) => void;
}) {
  const hasUnread = notifications.some((n) => !n.readAt);
  return (
    <section>
      <div className="notif-actions">
        <button type="button" className="btn btn-soft" onClick={onMarkAllRead} disabled={!hasUnread}>
          <Mail size={14} /> Mark all as read
        </button>
      </div>
      {notifications.length === 0 ? (
        <div className="empty-state">
          <Bell size={48} strokeWidth={1.3} />
          <p>You're all caught up.</p>
        </div>
      ) : (
        notifications.map((n) => (
          <div
            key={n.id}
            className={clsx("notification-row", !n.readAt && "is-unread")}
            onClick={() => onMarkRead(n)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter") onMarkRead(n);
            }}
          >
            <div className="icon-wrap">
              <Bell size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{n.title}</strong>
              <span className="body">{n.body}</span>
            </div>
            <span className="time">{formatRelativeTime(n.createdAt)}</span>
            {!n.readAt && <span className="dot-unread" aria-hidden />}
            <button
              type="button"
              className="admin-action-btn danger"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(n.id);
              }}
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}
    </section>
  );
}

/* ============================ Requests Tab ============================ */

function RequestsTab({
  approvals,
  onApprove,
  onReject,
}: {
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (approvals.length === 0) {
    return (
      <div className="empty-state">
        <ShieldAlert size={48} strokeWidth={1.3} />
        <p>No high-risk actions pending. New requests will appear here.</p>
      </div>
    );
  }
  return (
    <section className="approval-list">
      {approvals.map((approval) => {
        let payload: { reason?: string; estimatedTokens?: number } = {};
        try {
          payload = JSON.parse(approval.payload) as { reason?: string; estimatedTokens?: number };
        } catch {
          payload = {};
        }
        return (
          <article key={approval.id} className="approval-card">
            <div className="approval-avatar">
              <Bot size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: "0.95rem" }}>
                {approval.task.agent?.name ?? "Agent"} · {formatRelativeTime(approval.createdAt)}
              </strong>
              <p className="fine-print" style={{ margin: "8px 0", lineHeight: 1.5 }}>
                {payload.reason ?? approval.task.prompt}
              </p>
              <p className="fine-print" style={{ marginBottom: 12 }}>
                Estimated tokens: <strong style={{ color: "var(--ink)" }}>{formatNumber(payload.estimatedTokens ?? 0)}</strong>
              </p>
              {approval.status === "PENDING" && (
                <div className="action-row">
                  <button type="button" className="btn btn-success" onClick={() => onApprove(approval.id)}>
                    <Check size={14} /> Approve
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => onReject(approval.id)}>
                    <X size={14} /> Reject
                  </button>
                </div>
              )}
              {approval.status !== "PENDING" && (
                <span className={statusBadgeClass(approval.status)}>{approval.status}</span>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

/* ============================ Tasks Tab ============================ */

function TasksTab({
  tasks,
  stats,
}: {
  tasks: Task[];
  stats: { total: number; completed: number; pendingExec: number; needApproval: number; rejected: number };
}) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(tasks[0]?.id ?? null);

  return (
    <section>
      <div className="task-stat-row">
        <div className="task-stat-card">
          <span>Total tasks</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="task-stat-card tone-ok">
          <span>Completed</span>
          <strong>{stats.completed}</strong>
        </div>
        <div className="task-stat-card tone-warn">
          <span>In progress</span>
          <strong>{stats.pendingExec}</strong>
        </div>
        <div className="task-stat-card tone-info">
          <span>Awaiting approval</span>
          <strong>{stats.needApproval}</strong>
        </div>
        <div className="task-stat-card tone-bad">
          <span>Declined</span>
          <strong>{stats.rejected}</strong>
        </div>
      </div>
      <div className="workspace-card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="task-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Task</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 28 }}>
                  <p className="fine-print" style={{ margin: 0 }}>
                    No tasks yet — start chatting with an agent.
                  </p>
                </td>
              </tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="agent-icon" style={{ width: 30, height: 30, fontSize: "0.7rem" }}>
                      {userInitials(task.agent?.name ?? "A")}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{task.agent?.name ?? "Agent"}</span>
                  </div>
                </td>
                <td style={{ minWidth: 280 }}>
                  <strong style={{ display: "block", fontSize: "0.9rem" }}>
                    {task.prompt.slice(0, 120)}
                    {task.prompt.length > 120 ? "…" : ""}
                  </strong>
                  <span className="fine-print">
                    {formatNumber(task.tokenCost)} tokens · {task.actionType}
                  </span>
                </td>
                <td>
                  <span className={statusBadgeClass(task.status)}>{task.status.replaceAll("_", " ")}</span>
                </td>
                <td>
                  <span className="fine-print" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Clock size={12} />
                    {formatRelativeTime(task.createdAt)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ============================ Logs (terminal) ============================ */

function LogsTerminal({ logs }: { logs: SystemLog[] }) {
  const reversed = useMemo(() => [...logs].reverse(), [logs]);
  return (
    <div className="terminal" role="log" aria-live="polite">
      <div className="terminal-head">
        <span className="terminal-dot r" />
        <span className="terminal-dot y" />
        <span className="terminal-dot g" />
        <span className="terminal-title">~/pineapple/logs — tail -f</span>
      </div>
      <div className="terminal-body">
        {reversed.length === 0 && (
          <div className="terminal-line">
            <span className="msg">No log entries yet. Activity will stream here.</span>
            <span className="terminal-cursor" />
          </div>
        )}
        {reversed.map((log, idx) => (
          <div key={log.id} className="terminal-line">
            <span className="lno">{String(idx + 1).padStart(3, "0")}</span>
            <span className="ts">[{shortDate(log.createdAt)}]</span>
            <span className={`lvl ${log.level}`}>{log.level}</span>
            <span className="ev">{log.event}</span>
            <span className="msg">{log.summary}</span>
          </div>
        ))}
        {reversed.length > 0 && (
          <div className="terminal-line">
            <span className="lno">{String(reversed.length + 1).padStart(3, "0")}</span>
            <span className="msg">$</span> <span className="terminal-cursor" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================ Billing Panel (subscription / tokens split) ============================ */

function BillingPanel({
  data,
  subTab,
  setSubTab,
  startCheckout,
}: {
  data: AppData;
  subTab: BillingSubTab;
  setSubTab: (v: BillingSubTab) => void;
  startCheckout: (kind: "SUBSCRIPTION" | "TOKEN_PACK", code: string) => Promise<void>;
}) {
  const subRem = data.wallet?.subscriptionTokensRemaining ?? 0;
  const purRem = data.wallet?.purchasedTokensRemaining ?? 0;
  const subTransactions = data.transactions.filter((t) => t.kind === "SUBSCRIPTION");
  const tokenTransactions = data.transactions.filter((t) => t.kind === "TOKEN_PACK");

  return (
    <div className="market-stack">
      <div className="billing-tabs" role="tablist">
        <button
          type="button"
          className={clsx(subTab === "subscription" && "active")}
          onClick={() => setSubTab("subscription")}
        >
          <CreditCard size={14} /> Subscription
        </button>
        <button type="button" className={clsx(subTab === "tokens" && "active")} onClick={() => setSubTab("tokens")}>
          <Coins size={14} /> Tokens
        </button>
      </div>

      {subTab === "subscription" && (
        <>
          <div className="workspace-card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Active plan</div>
                <h2>{data.entitlement.plan.name}</h2>
              </div>
              <CheckCircle2 color="var(--success)" />
            </div>
            <p className="fine-print">
              Current period ends {new Date(data.entitlement.currentPeriodEnd).toDateString()}.
            </p>
            <div className="wallet-bars">
              <div className="wallet-line">
                <div>
                  <span>Subscription tokens</span>
                </div>
                <strong>{formatNumber(subRem)}</strong>
              </div>
              <div className="wallet-line">
                <div>
                  <span>Top-up tokens</span>
                </div>
                <strong>{formatNumber(purRem)}</strong>
              </div>
            </div>
          </div>

          <div className="workspace-card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Subscription</div>
                <h2>Recent payments</h2>
              </div>
            </div>
            {subTransactions.length === 0 ? (
              <p className="fine-print">No subscription payments yet.</p>
            ) : (
              <table className="task-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Transaction ID</th>
                    <th>Razorpay payment</th>
                  </tr>
                </thead>
                <tbody>
                  {subTransactions.map((t) => (
                    <tr key={t.id}>
                      <td>{shortDate(t.createdAt)}</td>
                      <td>{formatMoney(t.amountInr)}</td>
                      <td>
                        <span className={statusBadgeClass(t.status === "CAPTURED" ? "COMPLETED" : t.status)}>
                          {t.status}
                        </span>
                      </td>
                      <td><code className="ref-id">{t.id}</code></td>
                      <td>
                        {t.razorpayPaymentId ? (
                          <code className="ref-id">{t.razorpayPaymentId}</code>
                        ) : t.razorpayOrderId ? (
                          <span className="fine-print">order: <code className="ref-id">{t.razorpayOrderId}</code></span>
                        ) : (
                          <span className="fine-print">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {subTab === "tokens" && (
        <>
          <div className="token-balance-card">
            <div>
              <h2>Token wallet</h2>
              <p className="fine-print">
                Subscription: <strong>{formatNumber(subRem)}</strong> · Top-up: <strong>{formatNumber(purRem)}</strong>
              </p>
            </div>
            <div className="token-balance-metric">{formatTokenShort(subRem + purRem)}</div>
          </div>

          <div className="pack-row">
            {data.tokenPacks.map((pack) => {
              const featured = pack.tokens >= 800_000 && pack.tokens <= 1_500_000;
              return (
                <article key={pack.id} className={clsx("pack-card", featured && "pack-card-featured")}>
                  {featured && <span className="pack-feature-badge">Best value</span>}
                  <div className="pack-icon">
                    <Coins size={20} />
                  </div>
                  <strong className="pack-name">{pack.name}</strong>
                  <div className="pack-tokens">{formatNumber(pack.tokens)}</div>
                  <div className="pack-rate">
                    <strong>tokens</strong> · {ratePerOneThousand(pack.priceInr, pack.tokens)}
                  </div>
                  <div className="pack-cta">
                    <button
                      type="button"
                      className={clsx("btn btn-block", featured ? "btn-accent" : "btn-primary")}
                      disabled={data.entitlement.plan.code === "free"}
                      onClick={() => startCheckout("TOKEN_PACK", pack.code)}
                    >
                      {data.entitlement.plan.code === "free" ? "Upgrade first" : `Buy for ${formatMoney(pack.priceInr)}`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="workspace-card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Top-ups</div>
                <h2>Recent token purchases</h2>
              </div>
            </div>
            {tokenTransactions.length === 0 ? (
              <p className="fine-print">No token packs purchased yet.</p>
            ) : (
              <table className="task-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Transaction ID</th>
                    <th>Razorpay payment</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenTransactions.map((t) => (
                    <tr key={t.id}>
                      <td>{shortDate(t.createdAt)}</td>
                      <td>{formatMoney(t.amountInr)}</td>
                      <td>
                        <span className={statusBadgeClass(t.status === "CAPTURED" ? "COMPLETED" : t.status)}>
                          {t.status}
                        </span>
                      </td>
                      <td><code className="ref-id">{t.id}</code></td>
                      <td>
                        {t.razorpayPaymentId ? (
                          <code className="ref-id">{t.razorpayPaymentId}</code>
                        ) : t.razorpayOrderId ? (
                          <span className="fine-print">order: <code className="ref-id">{t.razorpayOrderId}</code></span>
                        ) : (
                          <span className="fine-print">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================ Profile Tab (My Profile) ============================ */

function ProfileTab({ user, onSaved }: { user: User; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        toast.show({ tone: "success", title: "Profile updated" });
        await onSaved();
      } else {
        const message = await readApiError(response);
        toast.show({ tone: "danger", title: "Could not save", body: message });
      }
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.show({ tone: "danger", title: "Passwords don't match" });
      return;
    }
    if (newPassword.length < 8) {
      toast.show({ tone: "danger", title: "New password too short", body: "Use at least 8 characters." });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.ok) {
        toast.show({ tone: "success", title: "Password updated" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const message = await readApiError(response);
        toast.show({ tone: "danger", title: "Password change failed", body: message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-grid">
      <form className="workspace-card" onSubmit={saveProfile}>
        <div className="card-head">
          <div>
            <div className="eyebrow">Account</div>
            <h2>Profile</h2>
          </div>
          <UserIcon color="var(--muted)" />
        </div>
        <div className="form-stack">
          <label>
            Display name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Email
            <input value={user.email} disabled />
          </label>
          <label>
            Role
            <input value={user.role} disabled />
          </label>
          <button type="submit" className="btn btn-primary" disabled={saving || name === user.name}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <form className="workspace-card" onSubmit={changePassword}>
        <div className="card-head">
          <div>
            <div className="eyebrow">Security</div>
            <h2>Change password</h2>
          </div>
          <Shield color="var(--muted)" />
        </div>
        <div className="form-stack">
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !currentPassword || !newPassword || !confirmPassword}
          >
            {saving ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================ Live Status panel ============================ */

function LiveStatusPanel({ data }: { data: AppData }) {
  const subRem = data.wallet?.subscriptionTokensRemaining ?? 0;
  const monthlyCap = data.entitlement.plan.monthlyTokens;
  const usedSub = monthlyCap > 0 ? Math.max(0, monthlyCap - subRem) : 0;
  const tokenBarPct = monthlyCap > 0 ? Math.min(100, (usedSub / monthlyCap) * 100) : 0;
  const deployed = data.userAgents.filter((a) => a.status === "DEPLOYED").length;
  const inFlight = data.tasks.filter((t) => t.status === "QUEUED" || t.status === "RUNNING").length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tasksToday = data.tasks.filter((t) => new Date(t.createdAt).getTime() >= today.getTime()).length;

  return (
    <div className="market-stack">
      <div className="stat-grid">
        <div className="stat-card">
          <span>Plan</span>
          <strong>{data.entitlement.plan.name}</strong>
          <div className="stat-card-trend">
            renews {new Date(data.entitlement.currentPeriodEnd).toLocaleDateString()}
          </div>
        </div>
        <div className="stat-card">
          <span>Tokens used</span>
          <strong>{Math.round(tokenBarPct)}%</strong>
          <div className="stat-card-trend">
            {formatTokenShort(usedSub)} / {monthlyCap > 0 ? formatTokenShort(monthlyCap) : "∞"}
          </div>
        </div>
        <div className="stat-card">
          <span>Deployed agents</span>
          <strong>{deployed}</strong>
        </div>
        <div className="stat-card">
          <span>Tasks today</span>
          <strong>{tasksToday}</strong>
          <div className="stat-card-trend">{inFlight} in flight</div>
        </div>
      </div>

      <div className="workspace-card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Realtime</div>
            <h2>Live signal</h2>
          </div>
          <span className="live-pill">Live</span>
        </div>
        <div className="terminal" style={{ marginTop: 10 }}>
          <div className="terminal-head">
            <span className="terminal-dot r" />
            <span className="terminal-dot y" />
            <span className="terminal-dot g" />
            <span className="terminal-title">~/pineapple/live</span>
          </div>
          <div className="terminal-body" style={{ maxHeight: 220 }}>
            <div className="terminal-line">
              <span className="lvl INFO">INFO</span> <span className="msg">workspace.ready</span>
            </div>
            <div className="terminal-line">
              <span className="lvl INFO">INFO</span> <span className="msg">tokens.subscription = {formatNumber(subRem)}</span>
            </div>
            <div className="terminal-line">
              <span className="lvl INFO">INFO</span>{" "}
              <span className="msg">agents.deployed = {deployed}</span>
            </div>
            <div className="terminal-line">
              <span className="lvl INFO">INFO</span>{" "}
              <span className="msg">tasks.in_flight = {inFlight}</span>
            </div>
            <div className="terminal-line">
              <span className="msg">$</span> <span className="terminal-cursor" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ (Deprecated) Admin Panel ============================ */
// NOTE: Superseded by `AdminConsole` (defined at the bottom of this file).
// Admin users now early-return into `AdminConsole`, which provides a dedicated
// monitor/control shell — no chat, marketplace, or end-user features.
// This function is intentionally retained but unused; it will be removed in a
// follow-up cleanup once the new console is signed off.

type AdminTab = "users" | "monetization" | "audit";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AdminPanel() {
  const toast = useToast();
  const [tab, setTab] = useState<AdminTab>("users");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "USER" | "ADMIN">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [drafts, setDrafts] = useState<Record<string, Partial<Plan>>>({});
  const [packDrafts, setPackDrafts] = useState<Record<string, Partial<TokenPack>>>({});
  const [activeUserDetail, setActiveUserDetail] = useState<AdminUserDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; email: string } | null>(null);

  async function loadOverview() {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Failed to load admin overview", body: await readApiError(response) });
      return;
    }
    const body = (await response.json()) as AdminOverview;
    setOverview(body);
    setDrafts(
      Object.fromEntries(
        body.plans.map((plan) => [
          plan.id,
          {
            monthlyPriceInr: plan.monthlyPriceInr,
            monthlyTokens: plan.monthlyTokens,
            maxAgents: plan.maxAgents,
            isActive: plan.isActive,
          },
        ]),
      ),
    );
    setPackDrafts(
      Object.fromEntries(
        body.tokenPacks.map((pack) => [
          pack.id,
          { priceInr: pack.priceInr, tokens: pack.tokens, name: pack.name, isActive: pack.isActive },
        ]),
      ),
    );
  }

  async function loadUsers() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter !== "ALL") params.set("role", roleFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Failed to load users", body: await readApiError(response) });
      return;
    }
    const body = (await response.json()) as { users: AdminUser[] };
    setUsers(body.users);
  }

  useEffect(() => {
    void loadOverview();
    void loadUsers();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadUsers(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter, statusFilter]);

  async function savePlan(planId: string) {
    const response = await fetch("/api/admin/overview", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, ...drafts[planId] }),
    });
    if (response.ok) {
      toast.show({ tone: "success", title: "Plan updated" });
    } else {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
    }
    await loadOverview();
  }

  async function savePack(packId: string) {
    const response = await fetch("/api/admin/overview", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId, ...packDrafts[packId] }),
    });
    if (response.ok) {
      toast.show({ tone: "success", title: "Token pack updated" });
    } else {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
    }
    await loadOverview();
  }

  async function patchUser(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
      return false;
    }
    toast.show({ tone: "success", title: "User updated" });
    await loadUsers();
    return true;
  }

  async function deleteUser(id: string) {
    const response = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Delete failed", body: await readApiError(response) });
      return false;
    }
    toast.show({ tone: "success", title: "User deleted" });
    await loadUsers();
    setConfirmDelete(null);
    return true;
  }

  async function viewUser(id: string) {
    setDrawerLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${id}`, { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as { user: AdminUserDetail };
      setActiveUserDetail(body.user);
    } finally {
      setDrawerLoading(false);
    }
  }

  return (
    <section className="admin-stack">
      <div className="stat-grid">
        <div className="stat-card">
          <span>Total users</span>
          <strong>{overview ? formatNumber(overview.metrics.users) : "—"}</strong>
        </div>
        <div className="stat-card">
          <span>Active subs</span>
          <strong>{overview ? formatNumber(overview.metrics.activeSubscriptions) : "—"}</strong>
        </div>
        <div className="stat-card">
          <span>Revenue</span>
          <strong>{overview ? formatMoney(overview.metrics.revenueInr) : "—"}</strong>
        </div>
        <div className="stat-card">
          <span>Plans</span>
          <strong>{overview ? overview.plans.length : "—"}</strong>
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        <button type="button" className={clsx(tab === "users" && "active")} onClick={() => setTab("users")}>
          <Users size={14} /> Users
        </button>
        <button
          type="button"
          className={clsx(tab === "monetization" && "active")}
          onClick={() => setTab("monetization")}
        >
          <CreditCard size={14} /> Plans & Packs
        </button>
        <button type="button" className={clsx(tab === "audit" && "active")} onClick={() => setTab("audit")}>
          <TerminalIcon size={14} /> Audit log
        </button>
      </div>

      {tab === "users" && (
        <div className="workspace-card" style={{ padding: 20 }}>
          <div className="admin-toolbar">
            <div className="admin-search">
              <Search size={16} />
              <input
                placeholder="Search by email or name…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
              style={{ width: "auto", minWidth: 130 }}
            >
              <option value="ALL">All roles</option>
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              style={{ width: "auto", minWidth: 140 }}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            <span className="fine-print" style={{ marginLeft: "auto" }}>
              {users.length} user{users.length === 1 ? "" : "s"}
            </span>
          </div>
          <table className="user-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Tokens</th>
                <th>Tasks</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24 }}>
                    <p className="fine-print" style={{ margin: 0 }}>
                      No users match these filters.
                    </p>
                  </td>
                </tr>
              )}
              {users.map((u) => {
                const sub = u.subscriptions[0]?.plan?.name ?? "Free";
                const tokens =
                  (u.wallet?.subscriptionTokensRemaining ?? 0) + (u.wallet?.purchasedTokensRemaining ?? 0);
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="user-row-name">
                        <div className="agent-icon" style={{ width: 32, height: 32, fontSize: "0.72rem" }}>
                          {userInitials(u.name)}
                        </div>
                        <div>
                          <strong style={{ display: "block" }}>{u.name}</strong>
                          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>{sub}</td>
                    <td>{formatTokenShort(tokens)}</td>
                    <td>{u._count.tasks}</td>
                    <td>
                      <span className={clsx("role-badge", u.role.toLowerCase())}>
                        {u.role === "ADMIN" ? <Shield size={11} /> : <UserIcon size={11} />}
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${u.status.toLowerCase()}`}>
                        {u.status === "ACTIVE" ? <Check size={11} /> : <X size={11} />}
                        {u.status}
                      </span>
                    </td>
                    <td>{shortDate(u.createdAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-action-btn"
                          title="View details"
                          onClick={() => viewUser(u.id)}
                        >
                          <Settings size={13} />
                        </button>
                        <button
                          type="button"
                          className="admin-action-btn"
                          title={u.role === "ADMIN" ? "Demote to user" : "Promote to admin"}
                          onClick={() => patchUser(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" })}
                        >
                          <UserCog size={13} />
                        </button>
                        <button
                          type="button"
                          className="admin-action-btn"
                          title={u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                          onClick={() =>
                            patchUser(u.id, { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })
                          }
                        >
                          {u.status === "ACTIVE" ? <ShieldAlert size={13} /> : <Check size={13} />}
                        </button>
                        <button
                          type="button"
                          className="admin-action-btn danger"
                          title="Delete"
                          onClick={() => setConfirmDelete({ id: u.id, email: u.email })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "monetization" && overview && (
        <>
          <div className="workspace-card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Subscription plans</div>
                <h2>Plans &amp; limits</h2>
              </div>
            </div>
            <div className="admin-table">
              {overview.plans.map((plan) => (
                <article key={plan.id}>
                  <strong>{plan.name}</strong>
                  <input
                    type="number"
                    value={drafts[plan.id]?.monthlyPriceInr ?? 0}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [plan.id]: { ...current[plan.id], monthlyPriceInr: Number(event.target.value) },
                      }))
                    }
                    placeholder="Price (INR)"
                  />
                  <input
                    type="number"
                    value={drafts[plan.id]?.monthlyTokens ?? 0}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [plan.id]: { ...current[plan.id], monthlyTokens: Number(event.target.value) },
                      }))
                    }
                    placeholder="Monthly tokens"
                  />
                  <input
                    type="number"
                    value={drafts[plan.id]?.maxAgents ?? 1}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [plan.id]: { ...current[plan.id], maxAgents: Number(event.target.value) },
                      }))
                    }
                    placeholder="Max agents"
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => savePlan(plan.id)}>
                    Save
                  </button>
                </article>
              ))}
            </div>
          </div>
          <div className="workspace-card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Token packs</div>
                <h2>Top-ups</h2>
              </div>
            </div>
            <div className="admin-table admin-table-pack">
              {overview.tokenPacks.map((pack) => (
                <article key={pack.id}>
                  <strong>{pack.name}</strong>
                  <input
                    type="number"
                    value={packDrafts[pack.id]?.priceInr ?? 0}
                    onChange={(event) =>
                      setPackDrafts((current) => ({
                        ...current,
                        [pack.id]: { ...current[pack.id], priceInr: Number(event.target.value) },
                      }))
                    }
                    placeholder="Price (INR)"
                  />
                  <input
                    type="number"
                    value={packDrafts[pack.id]?.tokens ?? 0}
                    onChange={(event) =>
                      setPackDrafts((current) => ({
                        ...current,
                        [pack.id]: { ...current[pack.id], tokens: Number(event.target.value) },
                      }))
                    }
                    placeholder="Tokens"
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => savePack(pack.id)}>
                    Save
                  </button>
                </article>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "audit" && overview && (
        <LogsTerminal logs={overview.logs} />
      )}

      {/* User detail drawer */}
      {activeUserDetail && (
        <UserDrawer
          detail={activeUserDetail}
          loading={drawerLoading}
          onClose={() => setActiveUserDetail(null)}
          onMutated={async () => {
            await loadUsers();
            await viewUser(activeUserDetail.id);
          }}
        />
      )}

      <ConfirmModal
        open={Boolean(confirmDelete)}
        title="Delete this user?"
        description={`This will permanently delete ${confirmDelete?.email ?? ""} along with their conversations, tasks and transactions. This cannot be undone.`}
        confirmLabel="Delete user"
        cancelLabel="Keep user"
        tone="danger"
        onConfirm={() => confirmDelete && deleteUser(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}

function UserDrawer({
  detail,
  loading,
  onClose,
  onMutated,
}: {
  detail: AdminUserDetail;
  loading: boolean;
  onClose: () => void;
  onMutated: () => Promise<void>;
}) {
  const toast = useToast();
  const [subDelta, setSubDelta] = useState(0);
  const [purDelta, setPurDelta] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function adjustWallet() {
    if (!subDelta && !purDelta) {
      toast.show({ tone: "warning", title: "Enter a non-zero delta" });
      return;
    }
    if (!reason.trim()) {
      toast.show({ tone: "warning", title: "Reason is required" });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${detail.id}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionDelta: subDelta || undefined,
          purchasedDelta: purDelta || undefined,
          reason,
        }),
      });
      if (response.ok) {
        toast.show({ tone: "success", title: "Wallet adjusted" });
        setSubDelta(0);
        setPurDelta(0);
        setReason("");
        await onMutated();
      } else {
        toast.show({ tone: "danger", title: "Adjust failed", body: await readApiError(response) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="User details">
        <header className="drawer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="agent-icon" style={{ width: 38, height: 38 }}>
              {userInitials(detail.name)}
            </div>
            <div>
              <h3>{detail.name}</h3>
              <p className="fine-print" style={{ margin: 0 }}>
                {detail.email}
              </p>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="drawer-body">
          {loading && <p className="fine-print">Loading…</p>}

          <section className="drawer-section">
            <h4>Account</h4>
            <div className="drawer-grid">
              <div className="drawer-row">
                <span>Role</span>
                <strong>{detail.role}</strong>
              </div>
              <div className="drawer-row">
                <span>Status</span>
                <strong>{detail.status}</strong>
              </div>
              <div className="drawer-row">
                <span>Joined</span>
                <strong>{shortDate(detail.createdAt)}</strong>
              </div>
              <div className="drawer-row">
                <span>Plan</span>
                <strong>{detail.subscriptions[0]?.plan?.name ?? "Free"}</strong>
              </div>
              <div className="drawer-row">
                <span>Conversations</span>
                <strong>{detail._count.conversations}</strong>
              </div>
              <div className="drawer-row">
                <span>Tasks</span>
                <strong>{detail._count.tasks}</strong>
              </div>
              <div className="drawer-row">
                <span>Messages</span>
                <strong>{detail._count.messages}</strong>
              </div>
              <div className="drawer-row">
                <span>Transactions</span>
                <strong>{detail._count.transactions}</strong>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h4>Wallet</h4>
            <div className="drawer-grid">
              <div className="drawer-row">
                <span>Subscription tokens</span>
                <strong>{formatNumber(detail.wallet?.subscriptionTokensRemaining ?? 0)}</strong>
              </div>
              <div className="drawer-row">
                <span>Top-up tokens</span>
                <strong>{formatNumber(detail.wallet?.purchasedTokensRemaining ?? 0)}</strong>
              </div>
            </div>
            <div className="drawer-grid" style={{ marginTop: 8 }}>
              <label>
                Subscription Δ
                <input type="number" value={subDelta} onChange={(event) => setSubDelta(Number(event.target.value))} />
              </label>
              <label>
                Top-up Δ
                <input type="number" value={purDelta} onChange={(event) => setPurDelta(Number(event.target.value))} />
              </label>
            </div>
            <label style={{ marginTop: 6, display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)" }}>
              Reason
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why are you adjusting?"
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={adjustWallet} disabled={busy}>
              {busy ? "Adjusting…" : "Adjust wallet"}
            </button>
          </section>

          <section className="drawer-section">
            <h4>Recent transactions</h4>
            {detail.transactions.length === 0 ? (
              <p className="fine-print">No transactions yet.</p>
            ) : (
              <table className="task-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Kind</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Refs</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{shortDate(t.createdAt)}</td>
                      <td>{t.kind}</td>
                      <td>{formatMoney(t.amountInr)}</td>
                      <td>
                        <span className={statusBadgeClass(t.status === "CAPTURED" ? "COMPLETED" : t.status)}>
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <div className="ref-stack">
                          <code className="ref-id" title="Internal transaction ID">{t.id}</code>
                          {t.razorpayOrderId && (
                            <code className="ref-id" title="Razorpay order ID">{t.razorpayOrderId}</code>
                          )}
                          {t.razorpayPaymentId && (
                            <code className="ref-id" title="Razorpay payment ID">{t.razorpayPaymentId}</code>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

/* ============================================================================
 *                        ADMIN CONSOLE  (replaces AdminPanel)
 * ----------------------------------------------------------------------------
 *  Dedicated monitor/control workspace for admin users. The admin role does
 *  NOT see chat, marketplace, my-agents, requests or any end-user surface –
 *  the admin's job is to observe and govern, never to participate.
 *
 *  Sections:
 *    overview  – high-level KPIs and recent activity
 *    users     – list / search / suspend / promote / delete; per-user drawer
 *    agents    – edit name, category, description, risk, active flag
 *    plans     – edit name, tagline, description, pricing, limits
 *    packs     – edit token packs (name, tokens, price)
 *    payments  – every payment transaction with full Razorpay refs/status
 *    audit     – PER-USER audit log (pick a user → see their activity)
 * ========================================================================= */

type AdminSectionKey =
  | "overview"
  | "users"
  | "agents"
  | "plans"
  | "packs"
  | "payments"
  | "audit";

const adminSections: Array<{
  key: AdminSectionKey;
  label: string;
  group: "Monitor" | "Govern" | "Commerce";
  icon: typeof MessageSquareText;
  description: string;
}> = [
  { key: "overview", group: "Monitor", label: "Overview", icon: Activity, description: "Platform KPIs at a glance." },
  { key: "users", group: "Monitor", label: "Users", icon: Users, description: "Every account on the platform." },
  { key: "audit", group: "Monitor", label: "Audit log", icon: TerminalIcon, description: "Per-user activity timeline." },
  { key: "agents", group: "Govern", label: "Agents", icon: Bot, description: "Edit catalogue, descriptions & risk." },
  { key: "plans", group: "Commerce", label: "Plans", icon: Rocket, description: "Subscription tiers & their copy." },
  { key: "packs", group: "Commerce", label: "Token packs", icon: Coins, description: "One-off top-up bundles." },
  { key: "payments", group: "Commerce", label: "Payments", icon: CreditCard, description: "Every transaction with Razorpay refs." },
];

function AdminConsole({
  user,
  themeMode,
  toggleTheme,
  onRequestLogout,
  logoutConfirmOpen,
  setLogoutConfirmOpen,
  performLogout,
}: {
  user: User;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  onRequestLogout: () => void;
  logoutConfirmOpen: boolean;
  setLogoutConfirmOpen: (v: boolean) => void;
  performLogout: () => Promise<void>;
}) {
  const [section, setSection] = useState<AdminSectionKey>("overview");
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);

  const grouped = useMemo(() => {
    const out: Record<string, typeof adminSections> = {};
    for (const item of adminSections) {
      out[item.group] = out[item.group] ?? [];
      out[item.group].push(item);
    }
    return out;
  }, []);

  const current = adminSections.find((s) => s.key === section)!;

  return (
    <main className="ac-shell">
      <aside className="ac-sidebar">
        <div className="ac-brand">
          <div className="ac-brand-mark" aria-hidden>P</div>
          <div className="ac-brand-text">
            <strong>PineApple</strong>
            <span>Admin Console</span>
          </div>
        </div>

        <nav className="ac-nav" aria-label="Admin sections">
          {Object.entries(grouped).map(([group, items]) => (
            <div className="ac-nav-group" key={group}>
              <div className="ac-nav-group-label">{group}</div>
              {items.map((item) => {
                const Icon = item.icon;
                const active = section === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={clsx("ac-nav-item", active && "active")}
                    onClick={() => setSection(item.key)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ac-sidebar-footer">
          <button
            type="button"
            className="ac-profile-trigger"
            onClick={() => setProfilePanelOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={profilePanelOpen}
          >
            <div className="ac-avatar" aria-hidden>{userInitials(user.name)}</div>
            <div className="ac-profile-meta">
              <span className="ac-profile-name">{user.name}</span>
              <span className="ac-profile-role">
                <Shield size={11} /> Administrator
              </span>
            </div>
            <ChevronUp size={14} style={{ color: "var(--muted)" }} />
          </button>
          {profilePanelOpen && (
            <div className="ac-profile-menu" role="menu">
              <div className="ac-profile-menu-head">
                <div className="ac-profile-menu-name">{user.name}</div>
                <div className="ac-profile-menu-email">{user.email}</div>
              </div>
              <button type="button" className="ac-profile-menu-item" onClick={toggleTheme}>
                {themeMode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                {themeMode === "dark" ? "Light theme" : "Dark theme"}
              </button>
              <button
                type="button"
                className="ac-profile-menu-item danger"
                onClick={() => {
                  setProfilePanelOpen(false);
                  onRequestLogout();
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="ac-main">
        <header className="ac-topbar">
          <div className="ac-topbar-text">
            <div className="ac-eyebrow">{current.group}</div>
            <h1 className="ac-title">{current.label}</h1>
            <p className="ac-subtitle">{current.description}</p>
          </div>
          <div className="ac-topbar-actions">
            <button
              type="button"
              className="ac-icon-btn"
              onClick={toggleTheme}
              aria-label={themeMode === "dark" ? "Switch to light" : "Switch to dark"}
              title={themeMode === "dark" ? "Light theme" : "Dark theme"}
            >
              {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <div className="ac-body">
          {section === "overview" && <AdminOverviewSection />}
          {section === "users" && <AdminUsersSection />}
          {section === "agents" && <AdminAgentsSection />}
          {section === "plans" && <AdminPlansSection />}
          {section === "packs" && <AdminPacksSection />}
          {section === "payments" && <AdminPaymentsSection />}
          {section === "audit" && <AdminAuditSection />}
        </div>
      </section>

      <ConfirmModal
        open={logoutConfirmOpen}
        title="Sign out of admin console?"
        description="You'll be returned to the sign-in screen."
        confirmLabel="Sign out"
        cancelLabel="Stay"
        tone="danger"
        onConfirm={performLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </main>
  );
}

/* ----------------------------- Overview section --------------------------- */

function AdminOverviewSection() {
  const toast = useToast();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/admin/overview", { cache: "no-store" });
        if (!response.ok) {
          toast.show({ tone: "danger", title: "Overview failed", body: await readApiError(response) });
          return;
        }
        const body = (await response.json()) as AdminOverview;
        if (alive) setOverview(body);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !overview) return <p className="ac-muted">Loading overview…</p>;

  const taskTotals = overview.metrics.taskCounts.reduce(
    (acc, t) => acc + (t._count?.status ?? 0),
    0,
  );

  return (
    <div className="ac-stack">
      <div className="ac-kpi-grid">
        <div className="ac-kpi">
          <span className="ac-kpi-label">Total users</span>
          <strong className="ac-kpi-value">{formatNumber(overview.metrics.users)}</strong>
        </div>
        <div className="ac-kpi">
          <span className="ac-kpi-label">Active subscriptions</span>
          <strong className="ac-kpi-value">{formatNumber(overview.metrics.activeSubscriptions)}</strong>
        </div>
        <div className="ac-kpi">
          <span className="ac-kpi-label">Lifetime revenue</span>
          <strong className="ac-kpi-value">{formatMoney(overview.metrics.revenueInr)}</strong>
        </div>
        <div className="ac-kpi">
          <span className="ac-kpi-label">Task events</span>
          <strong className="ac-kpi-value">{formatNumber(taskTotals)}</strong>
        </div>
      </div>

      <div className="ac-card">
        <div className="ac-card-head">
          <h3 className="ac-card-title">Tasks by status</h3>
        </div>
        <div className="ac-card-body">
          {overview.metrics.taskCounts.length === 0 ? (
            <p className="ac-muted">No task activity yet.</p>
          ) : (
            <div className="ac-status-chips">
              {overview.metrics.taskCounts.map((t) => (
                <span key={t.status} className={clsx("ac-chip", `ac-chip-${t.status.toLowerCase()}`)}>
                  {t.status.replaceAll("_", " ")} · {formatNumber(t._count.status)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ac-card">
        <div className="ac-card-head">
          <h3 className="ac-card-title">Recent activity</h3>
          <span className="ac-muted">latest 80 events</span>
        </div>
        <div className="ac-card-body">
          {overview.logs.length === 0 ? (
            <p className="ac-muted">No activity yet.</p>
          ) : (
            <ul className="ac-feed">
              {overview.logs.slice(0, 12).map((log) => (
                <li key={log.id} className="ac-feed-item">
                  <span className={clsx("ac-feed-level", `lvl-${log.level}`)}>{log.level}</span>
                  <div className="ac-feed-body">
                    <strong>{log.event}</strong>
                    <p>{log.summary}</p>
                  </div>
                  <time className="ac-feed-time">{shortDate(log.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Users section ----------------------------- */

function AdminUsersSection() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "USER" | "ADMIN">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [activeUserDetail, setActiveUserDetail] = useState<AdminUserDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; email: string } | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter !== "ALL") params.set("role", roleFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Failed to load users", body: await readApiError(response) });
      return;
    }
    const body = (await response.json()) as { users: AdminUser[] };
    setUsers(body.users);
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter, statusFilter]);

  async function patchUser(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
      return;
    }
    toast.show({ tone: "success", title: "User updated" });
    await load();
  }

  async function deleteUser(id: string) {
    const response = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Delete failed", body: await readApiError(response) });
      return;
    }
    toast.show({ tone: "success", title: "User deleted" });
    setConfirmDelete(null);
    await load();
  }

  async function viewUser(id: string) {
    setDrawerLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${id}`, { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as { user: AdminUserDetail };
      setActiveUserDetail(body.user);
    } finally {
      setDrawerLoading(false);
    }
  }

  return (
    <div className="ac-stack">
      <div className="ac-card ac-card-flush">
        <div className="ac-toolbar">
          <div className="ac-search">
            <Search size={14} />
            <input
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
          >
            <option value="ALL">All roles</option>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <span className="ac-muted ac-toolbar-count">
            {users.length} user{users.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Tokens</th>
                <th>Tasks</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="ac-empty">
                    No users match these filters.
                  </td>
                </tr>
              )}
              {users.map((u) => {
                const sub = u.subscriptions[0]?.plan?.name ?? "Free";
                const tokens =
                  (u.wallet?.subscriptionTokensRemaining ?? 0) + (u.wallet?.purchasedTokensRemaining ?? 0);
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="ac-user-cell">
                        <div className="ac-avatar ac-avatar-sm">{userInitials(u.name)}</div>
                        <div>
                          <strong>{u.name}</strong>
                          <span className="ac-muted">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>{sub}</td>
                    <td>{formatTokenShort(tokens)}</td>
                    <td>{u._count.tasks}</td>
                    <td>
                      <span className={clsx("ac-pill", u.role === "ADMIN" ? "ac-pill-admin" : "ac-pill-user")}>
                        {u.role === "ADMIN" ? <Shield size={11} /> : <UserIcon size={11} />}
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className={clsx("ac-pill", u.status === "ACTIVE" ? "ac-pill-ok" : "ac-pill-warn")}>
                        {u.status === "ACTIVE" ? <Check size={11} /> : <X size={11} />}
                        {u.status}
                      </span>
                    </td>
                    <td>{shortDate(u.createdAt)}</td>
                    <td>
                      <div className="ac-row-actions">
                        <button type="button" className="ac-icon-btn" title="Inspect" onClick={() => viewUser(u.id)}>
                          <Settings size={13} />
                        </button>
                        <button
                          type="button"
                          className="ac-icon-btn"
                          title={u.role === "ADMIN" ? "Demote to user" : "Promote to admin"}
                          onClick={() => patchUser(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" })}
                        >
                          <UserCog size={13} />
                        </button>
                        <button
                          type="button"
                          className="ac-icon-btn"
                          title={u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                          onClick={() =>
                            patchUser(u.id, { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })
                          }
                        >
                          {u.status === "ACTIVE" ? <ShieldAlert size={13} /> : <Check size={13} />}
                        </button>
                        <button
                          type="button"
                          className="ac-icon-btn ac-danger"
                          title="Delete"
                          onClick={() => setConfirmDelete({ id: u.id, email: u.email })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {activeUserDetail && (
        <UserDrawer
          detail={activeUserDetail}
          loading={drawerLoading}
          onClose={() => setActiveUserDetail(null)}
          onMutated={async () => {
            await load();
            await viewUser(activeUserDetail.id);
          }}
        />
      )}

      <ConfirmModal
        open={Boolean(confirmDelete)}
        title="Delete this user?"
        description={`This will permanently delete ${confirmDelete?.email ?? ""} along with their conversations, tasks and transactions. This cannot be undone.`}
        confirmLabel="Delete user"
        cancelLabel="Keep user"
        tone="danger"
        onConfirm={() => confirmDelete && deleteUser(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

/* ------------------------------ Agents section ---------------------------- */

function AdminAgentsSection() {
  const toast = useToast();
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<AdminAgent>>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/agents", { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed to load agents", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as { agents: AdminAgent[] };
      setAgents(body.agents);
      setDrafts(
        Object.fromEntries(
          body.agents.map((a) => [
            a.id,
            { name: a.name, category: a.category, description: a.description, riskLevel: a.riskLevel, isActive: a.isActive },
          ]),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string) {
    const response = await fetch(`/api/admin/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(drafts[id]),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
      return;
    }
    toast.show({ tone: "success", title: "Agent updated" });
    await load();
  }

  if (loading) return <p className="ac-muted">Loading agents…</p>;

  return (
    <div className="ac-stack">
      <p className="ac-muted ac-section-intro">
        Edit the public-facing copy users see in the marketplace. Risk level controls approval gating.
      </p>
      {agents.map((agent) => {
        const draft = drafts[agent.id] ?? {};
        const dirty =
          draft.name !== agent.name ||
          draft.category !== agent.category ||
          draft.description !== agent.description ||
          draft.riskLevel !== agent.riskLevel ||
          draft.isActive !== agent.isActive;
        return (
          <div key={agent.id} className="ac-card">
            <div className="ac-card-head">
              <div>
                <div className="ac-eyebrow">{agent.slug}</div>
                <h3 className="ac-card-title">{agent.name}</h3>
              </div>
              <div className="ac-card-head-stats">
                <span className="ac-stat-mini"><strong>{agent._count?.users ?? 0}</strong> users</span>
                <span className="ac-stat-mini"><strong>{agent._count?.tasks ?? 0}</strong> tasks</span>
              </div>
            </div>
            <div className="ac-card-body">
              <div className="ac-form-grid">
                <label className="ac-field">
                  <span>Name</span>
                  <input
                    value={draft.name ?? ""}
                    onChange={(event) =>
                      setDrafts((c) => ({ ...c, [agent.id]: { ...c[agent.id], name: event.target.value } }))
                    }
                  />
                </label>
                <label className="ac-field">
                  <span>Category</span>
                  <input
                    value={draft.category ?? ""}
                    onChange={(event) =>
                      setDrafts((c) => ({ ...c, [agent.id]: { ...c[agent.id], category: event.target.value } }))
                    }
                  />
                </label>
                <label className="ac-field">
                  <span>Risk level</span>
                  <select
                    value={draft.riskLevel ?? "LOW"}
                    onChange={(event) =>
                      setDrafts((c) => ({
                        ...c,
                        [agent.id]: { ...c[agent.id], riskLevel: event.target.value as Agent["riskLevel"] },
                      }))
                    }
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </label>
                <label className="ac-field ac-field-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.isActive)}
                    onChange={(event) =>
                      setDrafts((c) => ({ ...c, [agent.id]: { ...c[agent.id], isActive: event.target.checked } }))
                    }
                  />
                  <span>Active in marketplace</span>
                </label>
                <label className="ac-field ac-field-wide">
                  <span>Description / About</span>
                  <textarea
                    rows={3}
                    value={draft.description ?? ""}
                    onChange={(event) =>
                      setDrafts((c) => ({ ...c, [agent.id]: { ...c[agent.id], description: event.target.value } }))
                    }
                  />
                </label>
              </div>
              <div className="ac-form-actions">
                <button type="button" className="ac-btn ac-btn-primary" disabled={!dirty} onClick={() => save(agent.id)}>
                  {dirty ? "Save changes" : "Saved"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Plans section ---------------------------- */

function AdminPlansSection() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<Plan>>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as AdminOverview;
      setPlans(body.plans);
      setDrafts(
        Object.fromEntries(
          body.plans.map((p) => [
            p.id,
            {
              name: p.name,
              tagline: p.tagline ?? "",
              description: p.description ?? "",
              monthlyPriceInr: p.monthlyPriceInr,
              monthlyTokens: p.monthlyTokens,
              maxAgents: p.maxAgents,
              isActive: p.isActive,
            },
          ]),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string) {
    const response = await fetch("/api/admin/overview", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: id, ...drafts[id] }),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
      return;
    }
    toast.show({ tone: "success", title: "Plan updated" });
    await load();
  }

  if (loading) return <p className="ac-muted">Loading plans…</p>;

  return (
    <div className="ac-stack">
      <p className="ac-muted ac-section-intro">
        These are the subscription tiers users see on the marketplace. Edit the marketing copy, pricing and limits.
      </p>
      {plans.map((plan) => {
        const draft = drafts[plan.id] ?? {};
        return (
          <div key={plan.id} className="ac-card">
            <div className="ac-card-head">
              <div>
                <div className="ac-eyebrow">{plan.code}</div>
                <h3 className="ac-card-title">{plan.name}</h3>
              </div>
            </div>
            <div className="ac-card-body">
              <div className="ac-form-grid">
                <label className="ac-field">
                  <span>Display name</span>
                  <input
                    value={draft.name ?? ""}
                    onChange={(event) =>
                      setDrafts((c) => ({ ...c, [plan.id]: { ...c[plan.id], name: event.target.value } }))
                    }
                  />
                </label>
                <label className="ac-field">
                  <span>Tagline</span>
                  <input
                    placeholder="e.g. For growing teams"
                    value={draft.tagline ?? ""}
                    onChange={(event) =>
                      setDrafts((c) => ({ ...c, [plan.id]: { ...c[plan.id], tagline: event.target.value } }))
                    }
                  />
                </label>
                <label className="ac-field">
                  <span>Monthly price (INR)</span>
                  <input
                    type="number"
                    value={draft.monthlyPriceInr ?? 0}
                    onChange={(event) =>
                      setDrafts((c) => ({
                        ...c,
                        [plan.id]: { ...c[plan.id], monthlyPriceInr: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label className="ac-field">
                  <span>Monthly tokens</span>
                  <input
                    type="number"
                    value={draft.monthlyTokens ?? 0}
                    onChange={(event) =>
                      setDrafts((c) => ({
                        ...c,
                        [plan.id]: { ...c[plan.id], monthlyTokens: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label className="ac-field">
                  <span>Max agents</span>
                  <input
                    type="number"
                    value={draft.maxAgents ?? 1}
                    onChange={(event) =>
                      setDrafts((c) => ({
                        ...c,
                        [plan.id]: { ...c[plan.id], maxAgents: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label className="ac-field ac-field-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.isActive)}
                    onChange={(event) =>
                      setDrafts((c) => ({
                        ...c,
                        [plan.id]: { ...c[plan.id], isActive: event.target.checked },
                      }))
                    }
                  />
                  <span>Available to subscribe</span>
                </label>
                <label className="ac-field ac-field-wide">
                  <span>About / description</span>
                  <textarea
                    rows={3}
                    placeholder="Long-form copy describing what's included…"
                    value={draft.description ?? ""}
                    onChange={(event) =>
                      setDrafts((c) => ({
                        ...c,
                        [plan.id]: { ...c[plan.id], description: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="ac-form-actions">
                <button type="button" className="ac-btn ac-btn-primary" onClick={() => save(plan.id)}>
                  Save plan
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- Packs section --------------------------- */

function AdminPacksSection() {
  const toast = useToast();
  const [packs, setPacks] = useState<TokenPack[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<TokenPack>>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as AdminOverview;
      setPacks(body.tokenPacks);
      setDrafts(
        Object.fromEntries(
          body.tokenPacks.map((p) => [
            p.id,
            { name: p.name, tokens: p.tokens, priceInr: p.priceInr, isActive: p.isActive },
          ]),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string) {
    const response = await fetch("/api/admin/overview", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: id, ...drafts[id] }),
    });
    if (!response.ok) {
      toast.show({ tone: "danger", title: "Update failed", body: await readApiError(response) });
      return;
    }
    toast.show({ tone: "success", title: "Token pack updated" });
    await load();
  }

  if (loading) return <p className="ac-muted">Loading token packs…</p>;

  return (
    <div className="ac-stack">
      <p className="ac-muted ac-section-intro">
        One-off token bundles users can buy on top of any plan.
      </p>
      <div className="ac-card ac-card-flush">
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Tokens</th>
                <th>Price (INR)</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {packs.map((pack) => {
                const draft = drafts[pack.id] ?? {};
                return (
                  <tr key={pack.id}>
                    <td><code className="ac-code">{pack.code}</code></td>
                    <td>
                      <input
                        className="ac-input-cell"
                        value={draft.name ?? ""}
                        onChange={(event) =>
                          setDrafts((c) => ({ ...c, [pack.id]: { ...c[pack.id], name: event.target.value } }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="ac-input-cell"
                        value={draft.tokens ?? 0}
                        onChange={(event) =>
                          setDrafts((c) => ({
                            ...c,
                            [pack.id]: { ...c[pack.id], tokens: Number(event.target.value) },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="ac-input-cell"
                        value={draft.priceInr ?? 0}
                        onChange={(event) =>
                          setDrafts((c) => ({
                            ...c,
                            [pack.id]: { ...c[pack.id], priceInr: Number(event.target.value) },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.isActive)}
                        onChange={(event) =>
                          setDrafts((c) => ({
                            ...c,
                            [pack.id]: { ...c[pack.id], isActive: event.target.checked },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <button type="button" className="ac-btn ac-btn-sm" onClick={() => save(pack.id)}>
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Payments section -------------------------- */

function AdminPaymentsSection() {
  const toast = useToast();
  const [items, setItems] = useState<AdminPaymentTransaction[]>([]);
  const [status, setStatus] = useState<"ALL" | "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED">("ALL");
  const [kind, setKind] = useState<"ALL" | "SUBSCRIPTION" | "TOKEN_PACK">("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      if (kind !== "ALL") params.set("kind", kind);
      if (search) params.set("search", search);
      const response = await fetch(`/api/admin/payments?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as { transactions: AdminPaymentTransaction[] };
      setItems(body.transactions);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kind, search]);

  return (
    <div className="ac-stack">
      <div className="ac-card ac-card-flush">
        <div className="ac-toolbar">
          <div className="ac-search">
            <Search size={14} />
            <input
              placeholder="Search by Razorpay ID, transaction ID or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="ALL">All kinds</option>
            <option value="SUBSCRIPTION">Subscription</option>
            <option value="TOKEN_PACK">Token pack</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="ALL">All statuses</option>
            <option value="CREATED">Created</option>
            <option value="AUTHORIZED">Authorized</option>
            <option value="CAPTURED">Captured</option>
            <option value="FAILED">Failed</option>
            <option value="REFUNDED">Refunded</option>
          </select>
          <span className="ac-muted ac-toolbar-count">{items.length}</span>
        </div>

        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Kind</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Transaction ID</th>
                <th>Razorpay order</th>
                <th>Razorpay payment</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="ac-empty">
                    Loading transactions…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="ac-empty">
                    No transactions match these filters.
                  </td>
                </tr>
              )}
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{shortDate(t.createdAt)}</td>
                  <td>
                    <strong>{t.user.name}</strong>
                    <div className="ac-muted ac-mono">{t.user.email}</div>
                  </td>
                  <td>{t.kind === "TOKEN_PACK" ? "Token pack" : "Subscription"}</td>
                  <td>{formatMoney(t.amountInr)}</td>
                  <td>
                    <span className={clsx("ac-pill", paymentPillClass(t.status))}>{t.status}</span>
                  </td>
                  <td><code className="ac-code">{t.id}</code></td>
                  <td>
                    {t.razorpayOrderId ? (
                      <code className="ac-code">{t.razorpayOrderId}</code>
                    ) : (
                      <span className="ac-muted">—</span>
                    )}
                  </td>
                  <td>
                    {t.razorpayPaymentId ? (
                      <code className="ac-code">{t.razorpayPaymentId}</code>
                    ) : (
                      <span className="ac-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function paymentPillClass(status: string) {
  switch (status) {
    case "CAPTURED":
      return "ac-pill-ok";
    case "AUTHORIZED":
      return "ac-pill-info";
    case "FAILED":
      return "ac-pill-danger";
    case "REFUNDED":
      return "ac-pill-warn";
    default:
      return "ac-pill-neutral";
  }
}

/* --------------------------------- Audit ---------------------------------- */

function AdminAuditSection() {
  const toast = useToast();
  const [summaries, setSummaries] = useState<AdminAuditUserSummary[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<"ALL" | "INFO" | "WARN" | "ERROR" | "AUDIT">("ALL");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedUserId) params.set("userId", selectedUserId);
      if (level !== "ALL") params.set("level", level);
      if (search) params.set("search", search);
      const response = await fetch(`/api/admin/audit?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        toast.show({ tone: "danger", title: "Failed", body: await readApiError(response) });
        return;
      }
      const body = (await response.json()) as { logs: AdminAuditLog[]; summaries: AdminAuditUserSummary[] };
      setLogs(body.logs);
      setSummaries(body.summaries);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, level, search]);

  const filteredSummaries = useMemo(() => {
    if (!search.trim()) return summaries;
    const needle = search.toLowerCase();
    return summaries.filter(
      (s) => s.user.name.toLowerCase().includes(needle) || s.user.email.toLowerCase().includes(needle),
    );
  }, [summaries, search]);

  const selectedUser = summaries.find((s) => s.user.id === selectedUserId)?.user ?? null;

  return (
    <div className="ac-audit">
      <aside className="ac-audit-side">
        <div className="ac-audit-side-head">
          <h3>Users</h3>
          <span className="ac-muted">{summaries.length}</span>
        </div>
        <div className="ac-search ac-search-block">
          <Search size={13} />
          <input
            placeholder="Filter users…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={clsx("ac-audit-user", !selectedUserId && "active")}
          onClick={() => setSelectedUserId(null)}
        >
          <div className="ac-audit-user-meta">
            <strong>All users</strong>
            <span className="ac-muted">platform-wide stream</span>
          </div>
        </button>
        <div className="ac-audit-user-list">
          {filteredSummaries.map((s) => (
            <button
              key={s.user.id}
              type="button"
              className={clsx("ac-audit-user", selectedUserId === s.user.id && "active")}
              onClick={() => setSelectedUserId(s.user.id)}
            >
              <div className="ac-avatar ac-avatar-xs">{userInitials(s.user.name)}</div>
              <div className="ac-audit-user-meta">
                <strong>{s.user.name}</strong>
                <span className="ac-muted">{s.user.email}</span>
              </div>
              <span className="ac-audit-count">{s.count}</span>
            </button>
          ))}
          {filteredSummaries.length === 0 && (
            <p className="ac-muted ac-empty">No users found.</p>
          )}
        </div>
      </aside>

      <div className="ac-audit-main">
        <div className="ac-audit-toolbar">
          <div>
            <h3 className="ac-card-title">
              {selectedUser ? selectedUser.name : "All users"}
            </h3>
            <p className="ac-muted">
              {selectedUser ? selectedUser.email : "Cross-platform activity stream"}
              {" · "}
              {logs.length} event{logs.length === 1 ? "" : "s"}
            </p>
          </div>
          <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
            <option value="ALL">All levels</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warn</option>
            <option value="ERROR">Error</option>
            <option value="AUDIT">Audit</option>
          </select>
        </div>

        <div className="ac-card ac-card-flush">
          {loading ? (
            <p className="ac-muted ac-empty">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="ac-muted ac-empty">No audit events for this filter.</p>
          ) : (
            <ul className="ac-feed">
              {logs.map((log) => (
                <li key={log.id} className="ac-feed-item">
                  <span className={clsx("ac-feed-level", `lvl-${log.level}`)}>{log.level}</span>
                  <div className="ac-feed-body">
                    <strong>{log.event}</strong>
                    <p>{log.summary}</p>
                    {log.user && !selectedUserId && (
                      <span className="ac-muted ac-feed-actor">
                        {log.user.name} · {log.user.email}
                      </span>
                    )}
                  </div>
                  <time className="ac-feed-time">{shortDate(log.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
