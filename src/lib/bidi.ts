/** Unicode bidi controls for text that can't carry a `dir` attribute (placeholders, titles, option labels). */
const RLE = '‫';
const PDF = '‬';

/** Embeds each line as right-to-left so mixed Persian/English text keeps its order in an RTL context. */
export const rtl = (s: string) =>
  s
    .split('\n')
    .map((line) => (line ? `${RLE}${line}${PDF}` : line))
    .join('\n');

/** A number in Persian digits, so it reads naturally inside Persian text. */
export const fa = (n: number) => n.toLocaleString('fa-IR');
