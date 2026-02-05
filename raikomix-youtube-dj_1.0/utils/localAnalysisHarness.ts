// raikomix-youtube-dj_1.0/utils/localAnalysisHarness.ts
import { detectBpmFromAudioBuffer } from "./bpmDetection";

export async function runLocalAnalysisHarness() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.multiple = true;

  const pickFiles = () =>
    new Promise<File[]>((resolve) => {
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });

  const files = await pickFiles();
  if (!files.length) return;

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

  const rows: any[] = [];
  for (const f of files) {
    const ab = await f.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab.slice(0));

    const res = await detectBpmFromAudioBuffer(buf, { detectKey: true });

    rows.push({
      file: f.name,
      bpm: res.bpm,
      bpmConf: Math.round((res.confidence ?? 0) * 100) + "%",
      key: res.musicalKey,
      keyConf: Math.round((res.keyConfidence ?? 0) * 100) + "%",
      top: (res.candidates || [])
        .slice(0, 5)
        .map((c) => `${c.bpm.toFixed(1)}:${c.score.toFixed(3)}`)
        .join(" | "),
    });
  }

  console.table(rows);

  // Quick half/double check helper
  (window as any).__bpmHalfDouble = (bpm: number) => ({ half: bpm / 2, double: bpm * 2 });
}
