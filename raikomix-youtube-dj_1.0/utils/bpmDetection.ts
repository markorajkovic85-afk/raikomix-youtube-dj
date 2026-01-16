
export const extractBPMFromTitle = (title: string): number | null => {
  // Pattern 1: "128 BPM"
  const match1 = title.match(/(\d{2,3})\s*BPM/i);
  if (match1) return parseInt(match1[1]);
  
  // Pattern 2: "[128BPM]"
  const match2 = title.match(/\[(\d{2,3})BPM\]/i);
  if (match2) return parseInt(match2[1]);
  
  // Pattern 3: Common BPM ranges (60-180)
  const match3 = title.match(/\b(6[0-9]|7[0-9]|8[0-9]|9[0-9]|1[0-7][0-9]|180)\b/);
  if (match3 && parseInt(match3[1]) >= 60 && parseInt(match3[1]) <= 180) {
    return parseInt(match3[1]);
  }
  
  return null;
};

export const detectBpmFromAudioBuffer = (audioBuffer: AudioBuffer): number | null => {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = 1024;
  const hopSize = 512;
  const energies: number[] = [];

  for (let i = 0; i + windowSize < channelData.length; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j += 1) {
      const sample = channelData[i + j];
      sum += sample * sample;
    }
    energies.push(sum / windowSize);
  }

  if (energies.length < 2) return null;

  const avgEnergy = energies.reduce((acc, val) => acc + val, 0) / energies.length;
  const threshold = avgEnergy * 1.3;
  const peakIndices: number[] = [];

  for (let i = 1; i < energies.length - 1; i += 1) {
    if (energies[i] > threshold && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      peakIndices.push(i);
    }
  }

  if (peakIndices.length < 2) return null;

  const bpmCounts = new Map<number, number>();
  for (let i = 1; i < peakIndices.length; i += 1) {
    const intervalFrames = peakIndices[i] - peakIndices[i - 1];
    const intervalSeconds = (intervalFrames * hopSize) / sampleRate;
    if (intervalSeconds <= 0) continue;
    let bpm = 60 / intervalSeconds;

    while (bpm < 60) bpm *= 2;
    while (bpm > 200) bpm /= 2;

    const rounded = Math.round(bpm);
    bpmCounts.set(rounded, (bpmCounts.get(rounded) || 0) + 1);
  }

  let bestBpm: number | null = null;
  let bestCount = 0;
  bpmCounts.forEach((count, bpm) => {
    if (count > bestCount) {
      bestCount = count;
      bestBpm = bpm;
    }
  });

  return bestBpm;
};
