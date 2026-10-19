export interface SessionSummary {
  id: string;
  parentID?: string | null;
  title?: string;
  agent?: string;
  model?: { id?: string; providerID?: string };
  outcome?: string | null;
  time?: { created?: number; updated?: number; idle?: number };
}
export interface TaskCard {
  id: string;
  title: string;
  role: string;
  model: string;
  state: 'working' | 'waiting' | 'done' | 'failed' | 'stopped';
  elapsed: number;
  updated: number;
}
export interface TaskView {
  rootID: string;
  coordinatorActive: boolean;
  active: TaskCard[];
  finished: TaskCard[];
}
export function elapsedLabel(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
export function modelLabel(id: string): string {
  if (/deepseek/i.test(id)) return 'DeepSeek';
  if (/luna/i.test(id)) return 'Luna';
  if (/longcat/i.test(id)) return 'LongCat';
  if (/sol/i.test(id)) return 'Sol';
  return id || 'Modelo heredado';
}
export function buildTaskView(sessions: readonly SessionSummary[], visibleID: string, running: (id: string) => boolean, now: number): TaskView {
  const byID = new Map(sessions.map(session => [session.id, session]));
  const rootOf = (id: string) => {
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const parent = byID.get(id)?.parentID;
      if (!parent) return id;
      id = parent;
    }
    return '';
  };
  const rootID = rootOf(visibleID);
  const cards: TaskCard[] = sessions.filter(s => rootID && s.id !== rootID && rootOf(s.id) === rootID).map(s => {
    // Native liveness wins over an outcome from a previous correction round.
    const state: TaskCard['state'] = running(s.id) ? 'working'
      : s.outcome === 'succeeded' ? 'done'
      : s.outcome === 'failed' || s.outcome === 'error' ? 'failed'
      : s.outcome ? 'stopped' : 'waiting';
    const end = ['done', 'failed', 'stopped'].includes(state) ? (s.time?.idle || s.time?.updated || now) : now;
    return { id: s.id, title: s.title?.trim() || 'Tarea sin título', role: s.agent || 'worker',
      model: s.model?.id || '', state, elapsed: Math.max(0, end - (s.time?.created || end)), updated: s.time?.updated || 0 };
  });
  const active = cards.filter(c => c.state === 'working' || c.state === 'waiting').sort((a,b) => Number(b.state === 'working') - Number(a.state === 'working') || b.updated - a.updated);
  const finished = cards.filter(c => c.state !== 'working' && c.state !== 'waiting').sort((a,b) => b.updated - a.updated);
  return { rootID, coordinatorActive: !!rootID && running(rootID), active, finished };
}
