import { Transform, TransformCallback } from "node:stream";

const enum CharCode {
  LT = 60, // '<'
  GT = 62, // '>'
  SLASH = 47, // '/'
  DQUOTE = 34, // '"'
  SQUOTE = 39, // "'"
  EQUAL = 61, // '='
  SPACE = 32, // ' '
  TAB = 9, // '\t'
  LF = 10, // '\n'
  FF = 12, // '\f'
  CR = 13, // '\r'
}

const enum TagState {
  TagName = 1,
  AttributeName = 2,
  BeforeAttributeValue = 3,
  AttributeValue = 4,
}

const enum ParseState {
  Text = "text",
  Open = "open",
}

const enum QuoteState {
  None = 0,
  Double = 1,
  Single = 2,
}

const END_SCRIPT = Buffer.from("</script", "utf8");
const END_STYLE = Buffer.from("</style", "utf8");
const END_TITLE = Buffer.from("</title", "utf8");
const COMMENT_START = Buffer.from("<!--", "utf8");
const COMMENT_END = Buffer.from("-->", "utf8");
const CDATA_START = Buffer.from("<![CDATA[", "utf8");
const CDATA_END = Buffer.from("]]>", "utf8");

const RAW_TAG_PATTERNS = {
  script: END_SCRIPT,
  style: END_STYLE,
  title: END_TITLE,
} as const;

type TokenType = "text" | "open" | "close";
type Token = [TokenType, Buffer];

const isWhitespace = (byte: number): boolean =>
  byte === CharCode.SPACE ||
  byte === CharCode.TAB ||
  byte === CharCode.LF ||
  byte === CharCode.FF ||
  byte === CharCode.CR;

const toLowerCase = (byte: number): number =>
  byte >= 65 && byte <= 90 ? byte + 32 : byte;

const compareBuffers = (last: number[], pattern: Buffer): boolean => {
  if (last.length < pattern.length) return false;
  for (
    let i = last.length - 1, j = pattern.length - 1;
    i >= 0 && j >= 0;
    i--, j--
  ) {
    if (toLowerCase(last[i]) !== toLowerCase(pattern[j])) return false;
  }
  return true;
};

export class MarkupTokenizer extends Transform {
  private state: ParseState = ParseState.Text;
  private tagState: TagState | null = null;
  private quoteState: QuoteState = QuoteState.None;
  private rawEndPattern: Buffer | null = null;
  private buffers: Buffer[] = [];
  private lastBytes: number[] = [];
  private pendingBuffer: Buffer | null = null;
  private pendingOffset: number = 0;
  private fromRawMode: boolean = false;

  constructor() {
    super({ objectMode: true });
  }

  _transform = (
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void => {
    let buffer = chunk;
    let startIndex = 0;
    let currentOffset = 0;

    if (this.pendingBuffer) {
      buffer = Buffer.concat([this.pendingBuffer, chunk]);
      startIndex = this.pendingBuffer.length - 1;
      currentOffset = this.pendingOffset;
      this.pendingBuffer = null;
      this.pendingOffset = 0;
    }

    for (let i = startIndex; i < buffer.length; i++) {
      const byte = buffer[i];
      this.lastBytes.push(byte);
      if (this.lastBytes.length > 9) this.lastBytes.shift();

      if (this.rawEndPattern) {
        const result = this.testRawEnd(buffer, currentOffset, i);
        if (result) {
          this.pushToken("text", result[0]);
          
          const isCommentOrCdata = this.rawEndPattern === COMMENT_END || this.rawEndPattern === CDATA_END;
          if (isCommentOrCdata) {
            this.pushToken("close", result[1]);
            this.state = ParseState.Text;
            this.buffers = [];
          } else {
            this.state = ParseState.Open;
            this.buffers = [result[1]];
            this.fromRawMode = true;
          }

          this.rawEndPattern = null;
          currentOffset = i + 1;
        }
      } else if (
        this.state === ParseState.Text &&
        byte === CharCode.LT &&
        i === buffer.length - 1
      ) {
        this.pendingBuffer = buffer;
        this.pendingOffset = currentOffset;
        return callback();
      } else if (
        this.state === ParseState.Text &&
        byte === CharCode.LT &&
        !isWhitespace(buffer[i + 1])
      ) {
        if (i > 0 && i - currentOffset > 0) {
          this.buffers.push(buffer.subarray(currentOffset, i));
        }
        currentOffset = i;
        this.state = ParseState.Open;
        this.tagState = TagState.TagName;
        this.pushState("text");
      } else if (this.tagState === TagState.TagName && isWhitespace(byte)) {
        this.tagState = TagState.AttributeName;
      } else if (
        this.tagState === TagState.AttributeName &&
        byte === CharCode.EQUAL
      ) {
        this.tagState = TagState.BeforeAttributeValue;
      } else if (
        this.tagState === TagState.BeforeAttributeValue &&
        isWhitespace(byte)
      ) {
        // Skip whitespace
      } else if (
        this.tagState === TagState.BeforeAttributeValue &&
        byte !== CharCode.GT
      ) {
        this.tagState = TagState.AttributeValue;
        this.quoteState = 
          byte === CharCode.DQUOTE ? QuoteState.Double :
          byte === CharCode.SQUOTE ? QuoteState.Single :
          QuoteState.None;
      } else if (
        this.tagState === TagState.AttributeValue &&
        this.quoteState === QuoteState.None &&
        isWhitespace(byte)
      ) {
        this.tagState = TagState.AttributeName;
      } else if (
        this.tagState === TagState.AttributeValue &&
        this.quoteState === QuoteState.Double &&
        byte === CharCode.DQUOTE
      ) {
        this.quoteState = QuoteState.None;
        this.tagState = TagState.AttributeName;
      } else if (
        this.tagState === TagState.AttributeValue &&
        this.quoteState === QuoteState.Single &&
        byte === CharCode.SQUOTE
      ) {
        this.quoteState = QuoteState.None;
        this.tagState = TagState.AttributeName;
      } else if (
        this.state === ParseState.Open &&
        byte === CharCode.GT &&
        this.quoteState === QuoteState.None
      ) {
        this.buffers.push(buffer.subarray(currentOffset, i + 1));
        currentOffset = i + 1;
        this.state = ParseState.Text;
        this.tagState = null;

        if (this.fromRawMode) {
          this.fromRawMode = false;
          this.pushState("close");
        } else if (this.getByteAt(1) === CharCode.SLASH) {
          this.pushState("close");
        } else {
          const tagName = this.getTagName();
          this.rawEndPattern = RAW_TAG_PATTERNS[tagName as keyof typeof RAW_TAG_PATTERNS] || null;
          this.pushState("open");
        }
      } else if (
        this.state === ParseState.Open &&
        compareBuffers(this.lastBytes, COMMENT_START)
      ) {
        this.buffers.push(buffer.subarray(currentOffset, i + 1));
        this.pushState("open");
        currentOffset = i + 1;
        this.state = ParseState.Text;
        this.rawEndPattern = COMMENT_END;
      } else if (
        this.state === ParseState.Open &&
        compareBuffers(this.lastBytes, CDATA_START)
      ) {
        this.buffers.push(buffer.subarray(currentOffset, i + 1));
        this.pushState("open");
        currentOffset = i + 1;
        this.state = ParseState.Text;
        this.rawEndPattern = CDATA_END;
      }
    }

    if (currentOffset < buffer.length) {
      this.buffers.push(buffer.subarray(currentOffset));
    }

    callback();
  }

  _flush = (callback: TransformCallback): void => {
    if (this.state === ParseState.Text) {
      this.pushState("text");
    }
    this.push(null);
    callback();
  };

  private pushState = (tokenType: TokenType): void => {
    if (this.buffers.length === 0) return;
    const buffer = Buffer.concat(this.buffers);
    this.buffers = [];
    this.pushToken(tokenType, buffer);
  };

  private pushToken = (tokenType: TokenType, buffer: Buffer): void => {
    this.push([tokenType, buffer] as Token);
  };

  private getByteAt = (index: number): number | undefined => {
    let offset = 0;
    for (const buffer of this.buffers) {
      if (offset + buffer.length > index) {
        return buffer[index - offset];
      }
      offset += buffer.length;
    }
    return undefined;
  };

  private getTagName = (): string => {
    let tagName = "";
    let skipFirst = true;

    for (const buffer of this.buffers) {
      for (let k = 0; k < buffer.length; k++) {
        if (skipFirst && k === 0) {
          skipFirst = false;
          continue; // Skip initial '<'
        }
        
        const byte = buffer[k];
        // Check for valid tag name characters (faster than regex)
        if ((byte >= 65 && byte <= 90) ||   // A-Z
            (byte >= 97 && byte <= 122) ||  // a-z
            (byte >= 48 && byte <= 57) ||   // 0-9
            byte === 45 ||                  // -
            byte === 33 ||                  // !
            byte === 91 ||                  // [
            byte === 93) {                  // ]
          tagName += String.fromCharCode(byte);
        } else {
          return tagName.toLowerCase();
        }
      }
    }

    return tagName.toLowerCase();
  };

  private testRawEnd = (
    buffer: Buffer,
    offset: number,
    index: number
  ): [Buffer, Buffer] | null => {
    if (
      !this.rawEndPattern ||
      !compareBuffers(this.lastBytes, this.rawEndPattern)
    ) {
      return null;
    }

    this.buffers.push(buffer.subarray(offset, index + 1));
    const combined = Buffer.concat(this.buffers);
    const splitIndex = combined.length - this.rawEndPattern.length;

    // For all raw end patterns, return content and end tag separately
    return [combined.subarray(0, splitIndex), combined.subarray(splitIndex)];
  };
}

export default MarkupTokenizer;
