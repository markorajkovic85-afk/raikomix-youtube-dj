
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
