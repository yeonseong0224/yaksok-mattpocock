const graphemes = new Intl.Segmenter("ko", { granularity: "grapheme" });

/** 화면에 보이는 글자(grapheme) 수. 👨‍👩‍👧는 1자다(MEMBER-05-01, STATE-03-01). */
export function countGraphemes(text: string): number {
  return [...graphemes.segment(text)].length;
}
