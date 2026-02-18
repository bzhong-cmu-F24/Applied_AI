const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export interface Friend {
  name: string;
  location: { lat: number; lng: number; address: string };
  preferences: {
    likes: string[];
    dislikes: string[];
    allergies: string[];
  };
}

export interface AgentStep {
  type: "thinking" | "tool_call" | "tool_result" | "final" | "error" | "session" | "text_delta" | "thinking_done" | "final_done";
  content: unknown;
}

export async function fetchFriends(): Promise<Friend[]> {
  const res = await fetch(`${API_BASE}/api/friends`);
  if (!res.ok) throw new Error("Failed to fetch friends");
  return res.json();
}

export interface UserLocationPayload {
  lat: number;
  lng: number;
  address: string;
}

export async function streamPlan(
  message: string,
  sessionId: string | null,
  onStep: (step: AgentStep) => void,
  onSession: (id: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  userLocation?: UserLocationPayload | null
) {
  const body: { message: string; session_id?: string; user_location?: UserLocationPayload } = { message };
  if (sessionId) body.session_id = sessionId;
  if (userLocation) body.user_location = userLocation;

  const res = await fetch(`${API_BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    onError(`Server error: ${res.status}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError("No response stream");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") {
        onDone();
        return;
      }
      try {
        const step: AgentStep = JSON.parse(data);
        // Handle session ID event
        if (step.type === "session") {
          onSession(step.content as string);
          continue;
        }
        onStep(step);
      } catch {
        // skip malformed lines
      }
    }
  }
  onDone();
}
