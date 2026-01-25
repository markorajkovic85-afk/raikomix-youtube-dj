export const buildWaveformPeaks = (audioBuffer: AudioBuffer, samples = 900): number[] => {
  const channels = audioBuffer.numberOfChannels;
  if (channels === 0) return [];

  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i += 1) {
    channelData.push(audioBuffer.getChannelData(i));
  }

  const totalSamples = channelData[0].length;
  const blockSize = Math.max(1, Math.floor(totalSamples / samples));
  const peaks: number[] = [];

  for (let i = 0; i < samples; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, totalSamples);
    let peak = 0;

    for (let j = start; j < end; j += 1) {
      let sample = 0;
      for (let c = 0; c < channels; c += 1) {
        sample += channelData[c][j];
      }
      sample /= channels;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(0.00001, ...peaks);
  const normalized = peaks.map((value) => Math.min(1, value / maxPeak));
  const smoothed: number[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const prev = normalized[i - 1] ?? normalized[i];
    const next = normalized[i + 1] ?? normalized[i];
    smoothed.push((prev + normalized[i] + next) / 3);
  }

  return smoothed;
};
