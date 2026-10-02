/** Typy dla word-extractor 1.0.4 (paczka nie ma własnych): tylko to, czego używa src/druki/odczyt.ts. */
declare module 'word-extractor' {
  interface DokumentWord {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
  }
  export default class WordExtractor {
    extract(zrodlo: Buffer | string): Promise<DokumentWord>;
  }
}
