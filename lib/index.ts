import { Transform, TransformCallback } from "node:stream";

// Character codes for V8 optimization (cached constants)
const LT = 60; // '<'
const GT = 62; // '>'
const SLASH = 47; // '/'
const DQUOTE = 34; // '"'
const SQUOTE = 39; // "'"
const EQUAL = 61; // '='
const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const FF = 0x0c;
const CR = 0x0d;

// State constants for monomorphic property access
const TEXT_STATE = 0;
const OPEN_STATE = 1;

const TAG_NAME_STATE = 1;
const ATTRIBUTE_NAME_STATE = 2;
const BEFORE_ATTRIBUTE_VALUE_STATE = 3;
const ATTRIBUTE_VALUE_STATE = 4;

const NO_QUOTE = 0;
const DOUBLE_QUOTE = 1;
const SINGLE_QUOTE = 2;

// Pre-compiled buffers
const END_SCRIPT = Buffer.from("</script", "utf8");
const END_STYLE = Buffer.from("</style", "utf8");
const END_TITLE = Buffer.from("</title", "utf8");
const COMMENT_START = Buffer.from("<!--", "utf8");
const COMMENT_END = Buffer.from("-->", "utf8");

type TokenType = "text" | "open" | "close";
type Token = [TokenType, Buffer];

interface MarkupTokenizerOptions {
  ignoreText?: boolean;
}

function compare(a: number[], b: Buffer): boolean {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen < bLen) return false;

  for (let i = aLen - 1, j = bLen - 1; i >= 0 && j >= 0; i--, j--) {
    const aChar = a[i];
    const bChar = b[j];
    // Inline toLowerCase for performance
    const aLower = aChar >= 65 && aChar <= 90 ? aChar + 32 : aChar;
    const bLower = bChar >= 65 && bChar <= 90 ? bChar + 32 : bChar;
    if (aLower !== bLower) return false;
  }
  return true;
}

export class MarkupTokenizer extends Transform {
  private state: number = TEXT_STATE;
  private tagState: number = 0;
  private quoteState: number = NO_QUOTE;
  private raw: Buffer | null = null;
  private buffers: Buffer[] = [];
  private ignoreText: boolean = false;

  // Circular buffer for last bytes (more efficient than push/shift)
  private _last: number[] = new Array(9);
  private _lastIndex: number = 0;
  private _lastCount: number = 0;

  private _prev: Buffer | null = null;
  private _offset: number = 0;

  constructor(options: MarkupTokenizerOptions = {}) {
    super({ objectMode: true });
    this.ignoreText = options.ignoreText ?? false;
  }

  _transform = (
    buf: Buffer,
    enc: BufferEncoding,
    next: TransformCallback
  ): void => {
    let i = 0;
    let offset = 0;
    const bufLen = buf.length;

    // Handle pending buffer from previous chunk
    if (this._prev) {
      buf = Buffer.concat([this._prev, buf]);
      i = this._prev.length - 1;
      offset = this._offset;
      this._prev = null;
      this._offset = 0;
    }

    // Main parsing loop - optimized for V8
    for (; i < buf.length; i++) {
      const b = buf[i];

      // Circular buffer update (more efficient than push/shift)
      this._last[this._lastIndex] = b;
      this._lastIndex = (this._lastIndex + 1) % 9;
      if (this._lastCount < 9) this._lastCount++;

      // Raw mode handling (comments, script, style, title)
      if (this.raw) {
        const parts = this._testRaw(buf, offset, i);
        if (parts) {
          if (!this.ignoreText) {
            this.push(["text", parts[0]]);
          }

          if (this.raw === COMMENT_END) {
            this.state = TEXT_STATE;
            this.buffers = [];
            this.push(["close", parts[1]]);
          } else {
            // For script/style/title tags, we need to continue parsing the closing tag
            this.state = OPEN_STATE;
            this.tagState = TAG_NAME_STATE;
            this.buffers = [parts[1]];
          }

          this.raw = null;
          offset = i + 1;
        }
      }
      // Most common case first: text parsing
      else if (this.state === TEXT_STATE) {
        if (b === LT) {
          if (i === buf.length - 1) {
            // Need more data
            this._prev = buf;
            this._offset = offset;
            return next();
          }
          // Inline whitespace check for performance
          const nextByte = buf[i + 1];
          if (
            nextByte !== SPACE &&
            nextByte !== TAB &&
            nextByte !== LF &&
            nextByte !== FF &&
            nextByte !== CR
          ) {
            if (i > offset) {
              if (!this.ignoreText) {
                this.buffers.push(buf.subarray(offset, i));
              }
            }
            offset = i;
            this.state = OPEN_STATE;
            this.tagState = TAG_NAME_STATE;
            if (!this.ignoreText) {
              this._pushState("text");
            }
          }
        }
      }
      // Tag parsing state machine
      else if (this.state === OPEN_STATE) {
        // Check for comment first (less common but needs early detection)
        if (compare(this._getLastBytes(), COMMENT_START)) {
          this.buffers.push(buf.subarray(offset, i + 1));
          offset = i + 1;
          this.state = TEXT_STATE;
          this.raw = COMMENT_END;
          this._pushState("open");
        }
        // Tag name state
        else if (this.tagState === TAG_NAME_STATE) {
          // Inline whitespace check
          if (b === SPACE || b === TAB || b === LF || b === FF || b === CR) {
            this.tagState = ATTRIBUTE_NAME_STATE;
          } else if (b === GT) {
            this._handleTagClose(buf, offset, i);
            offset = i + 1;
          }
        }
        // Attribute name state
        else if (this.tagState === ATTRIBUTE_NAME_STATE) {
          if (b === EQUAL) {
            this.tagState = BEFORE_ATTRIBUTE_VALUE_STATE;
          } else if (b === GT) {
            this._handleTagClose(buf, offset, i);
            offset = i + 1;
          }
        }
        // Before attribute value state
        else if (this.tagState === BEFORE_ATTRIBUTE_VALUE_STATE) {
          // Skip whitespace
          if (b !== SPACE && b !== TAB && b !== LF && b !== FF && b !== CR) {
            if (b === GT) {
              this._handleTagClose(buf, offset, i);
              offset = i + 1;
            } else {
              this.tagState = ATTRIBUTE_VALUE_STATE;
              this.quoteState =
                b === DQUOTE
                  ? DOUBLE_QUOTE
                  : b === SQUOTE
                  ? SINGLE_QUOTE
                  : NO_QUOTE;
            }
          }
        }
        // Attribute value state
        else if (this.tagState === ATTRIBUTE_VALUE_STATE) {
          if (this.quoteState === NO_QUOTE) {
            if (b === SPACE || b === TAB || b === LF || b === FF || b === CR) {
              this.tagState = ATTRIBUTE_NAME_STATE;
            } else if (b === GT) {
              this._handleTagClose(buf, offset, i);
              offset = i + 1;
            }
          } else if (this.quoteState === DOUBLE_QUOTE && b === DQUOTE) {
            this.quoteState = NO_QUOTE;
            this.tagState = ATTRIBUTE_NAME_STATE;
          } else if (this.quoteState === SINGLE_QUOTE && b === SQUOTE) {
            this.quoteState = NO_QUOTE;
            this.tagState = ATTRIBUTE_NAME_STATE;
          }
        }
      }
    }

    if (offset < buf.length && !this.ignoreText) this.buffers.push(buf.subarray(offset));
    next();
  };

  _flush = (next: TransformCallback): void => {
    if (this.state === TEXT_STATE && !this.ignoreText) this._pushState("text");
    this.push(null);
    next();
  };

  private _handleTagClose(buf: Buffer, offset: number, i: number): void {
    this.buffers.push(buf.subarray(offset, i + 1));
    this.state = TEXT_STATE;
    this.tagState = 0;
    this.quoteState = NO_QUOTE;

    if (this._getChar(1) === SLASH) {
      this._pushState("close");
    } else {
      const tag = this._getTag();
      if (tag === "script") this.raw = END_SCRIPT;
      else if (tag === "style") this.raw = END_STYLE;
      else if (tag === "title") this.raw = END_TITLE;
      this._pushState("open");
    }
  }

  private _pushState = (ev: TokenType): void => {
    if (this.buffers.length === 0) return;
    if (this.ignoreText && ev === "text") {
      this.buffers = [];
      return;
    }
    const buf = Buffer.concat(this.buffers);
    this.buffers = [];
    this.push([ev, buf] as Token);
  };

  private _getChar = (index: number): number | undefined => {
    let offset = 0;
    for (let j = 0; j < this.buffers.length; j++) {
      const buf = this.buffers[j];
      if (offset + buf.length > index) {
        return buf[index - offset];
      }
      offset += buf.length;
    }
  };

  private _getTag = (): string => {
    let tag = "";
    for (let j = 0; j < this.buffers.length; j++) {
      const buf = this.buffers[j];
      for (let k = j === 0 ? 1 : 0; k < buf.length; k++) {
        const c = buf[k];
        // More efficient tag name validation
        if (
          (c >= 65 && c <= 90) ||
          (c >= 97 && c <= 122) ||
          (c >= 48 && c <= 57) ||
          c === 45 ||
          c === 33 ||
          c === 91 ||
          c === 93
        ) {
          tag += String.fromCharCode(c);
        } else {
          return tag.toLowerCase();
        }
      }
    }
    return tag.toLowerCase();
  };

  private _getLastBytes(): number[] {
    const result: number[] = [];
    const count = Math.min(this._lastCount, 9);
    for (let i = 0; i < count; i++) {
      const idx = (this._lastIndex - count + i + 9) % 9;
      result.push(this._last[idx]);
    }
    return result;
  }

  private _testRaw = (
    buf: Buffer,
    offset: number,
    index: number
  ): [Buffer, Buffer] | null => {
    const raw = this.raw;
    if (!raw || !compare(this._getLastBytes(), raw)) return null;

    this.buffers.push(buf.subarray(offset, index + 1));
    const buffer = Buffer.concat(this.buffers);
    const k = buffer.length - raw.length;
    return [buffer.subarray(0, k), buffer.subarray(k)];
  };
}

export default (options?: MarkupTokenizerOptions) => {
  return new MarkupTokenizer(options);
};
