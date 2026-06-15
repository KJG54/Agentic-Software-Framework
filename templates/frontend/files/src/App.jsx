// {{slug}} — {{summary}}
import { useState } from "react";
import { formatGreeting } from "./lib/format.js";

export default function App() {
  const [name, setName] = useState("");
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>{formatGreeting(name)}</h1>
      <input
        aria-label="name"
        placeholder="your name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p>Edit <code>src/App.jsx</code> to start building {{slug}}.</p>
    </main>
  );
}
