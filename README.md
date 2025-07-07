# markup-tokenizer

High-performance markup tokenizer transform stream for Node.js.

## Installation

```sh
npm install markup-tokenizer
```

## Usage

```ts
import { createReadStream } from "node:fs";
import tokenizer from "markup-tokenizer";

createReadStream("./index.html").pipe(tokenizer());
```

For the following HTML:

```html
<section>
  <a href="/hello">hello</a>
</section>
```

This produces:

```
["open", "<section>"]
[("text", "\n  ")]
[("open", '<a href="/hello">')]
[("text", "hello")]
[("close", "</a>")]
[("text", "\n")]
[("close", "</section>")]
```
