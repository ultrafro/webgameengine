"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Tab = "assets" | "ai";

interface AssetItem {
  name: string;
  category: string;
  thumbnail: string;
  type: string;
}

const DUMMY_ASSETS: AssetItem[] = [
  { name: "Wooden Crate", category: "Props", thumbnail: "📦", type: "box" },
  { name: "Stone Wall", category: "Props", thumbnail: "🧱", type: "box" },
  { name: "Metal Barrel", category: "Props", thumbnail: "🛢️", type: "cylinder" },
  { name: "Crystal Sphere", category: "Props", thumbnail: "🔮", type: "sphere" },
  { name: "Ground Plane", category: "Environment", thumbnail: "🟫", type: "plane" },
  { name: "Pine Tree", category: "Nature", thumbnail: "🌲", type: "cylinder" },
  { name: "Rock", category: "Nature", thumbnail: "🪨", type: "sphere" },
  { name: "Character", category: "Characters", thumbnail: "🧍", type: "capsule" },
  { name: "Sun Light", category: "Lights", thumbnail: "☀️", type: "directionalLight" },
  { name: "Ambient Light", category: "Lights", thumbnail: "💡", type: "ambientLight" },
  { name: "Sky Light", category: "Lights", thumbnail: "🌤️", type: "hemisphereLight" },
  { name: "Torch", category: "Props", thumbnail: "🔦", type: "cylinder" },
];

const CATEGORIES = ["All", "Props", "Environment", "Nature", "Characters", "Lights"];

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

let messageIdCounter = 0;

export default function Home() {
  const [tab, setTab] = useState<Tab>("assets");
  const [panelOpen, setPanelOpen] = useState(true);
  const [category, setCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "system", content: "Connected to WebGameEngine. Send commands to control the editor." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const pendingCallbacks = useRef<Map<number, (data: unknown) => void>>(new Map());

  // Send command to editor iframe
  const sendCommand = useCallback(
    (type: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      return new Promise((resolve) => {
        const id = messageIdCounter++;
        pendingCallbacks.current.set(id, resolve);
        iframeRef.current?.contentWindow?.postMessage(
          { type, params, id, source: "webgameengine" },
          "*"
        );
        // Timeout fallback
        setTimeout(() => {
          if (pendingCallbacks.current.has(id)) {
            pendingCallbacks.current.delete(id);
            resolve(null);
          }
        }, 5000);
      });
    },
    []
  );

  // Listen for responses from editor
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (data && data.id !== undefined && data.type === "response") {
        const cb = pendingCallbacks.current.get(data.id);
        if (cb) {
          pendingCallbacks.current.delete(data.id);
          cb(data.data);
        }
      }
    }
    window.addEventListener("message", handleMessage);

    // Forward keyboard events to iframe so WASD works even when parent has focus
    function forwardKey(e: KeyboardEvent) {
      // Don't forward when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const iframe = document.querySelector("iframe");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: "keyEvent",
            source: "webgameengine",
            eventType: e.type,
            code: e.code,
            key: e.key,
          },
          "*"
        );
      }
    }
    window.addEventListener("keydown", forwardKey);
    window.addEventListener("keyup", forwardKey);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("keydown", forwardKey);
      window.removeEventListener("keyup", forwardKey);
    };
  }, []);

  // Add asset to scene
  const addAssetToScene = useCallback(
    (asset: AssetItem) => {
      const params: Record<string, unknown> = {
        objectType: asset.type,
        name: asset.name,
        position: { x: 0, y: asset.type === "plane" ? 0 : 1, z: 0 },
      };

      if (asset.type === "plane") {
        params.width = 20;
        params.height = 20;
        params.userData = {
          physics: { bodyType: "fixed", collider: "cuboid", friction: 0.8 },
        };
      }

      sendCommand("addObject", params);
    },
    [sendCommand]
  );

  // Parse simple commands from chat
  const handleChatSubmit = useCallback(async () => {
    if (!chatInput.trim()) return;
    const input = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: input }]);

    // Simple command parser
    const lower = input.toLowerCase();
    let reply = "";

    if (lower === "play" || lower === "start") {
      sendCommand("play");
      reply = "Started play mode.";
    } else if (lower === "stop") {
      sendCommand("stop");
      reply = "Stopped play mode.";
    } else if (lower === "clear") {
      sendCommand("clear");
      reply = "Scene cleared.";
    } else if (lower === "list" || lower === "objects") {
      const objects = await sendCommand("listObjects");
      reply = "Scene objects:\n```json\n" + JSON.stringify(objects, null, 2) + "\n```";
    } else if (lower.startsWith("add ")) {
      const what = lower.slice(4).trim();
      const typeMap: Record<string, string> = {
        box: "box", cube: "box", sphere: "sphere", ball: "sphere",
        plane: "plane", ground: "plane", floor: "plane",
        cylinder: "cylinder", capsule: "capsule",
        light: "directionalLight", "sun light": "directionalLight",
        "ambient light": "ambientLight",
      };
      const objectType = typeMap[what] || "box";
      await sendCommand("addObject", {
        objectType,
        name: what.charAt(0).toUpperCase() + what.slice(1),
        position: { x: 0, y: objectType === "plane" ? 0 : 1, z: 0 },
      });
      reply = `Added ${what} to scene.`;
    } else if (lower === "setup scene" || lower === "setup game") {
      // Quick scene setup
      await sendCommand("addObject", {
        objectType: "plane", name: "Ground", position: { x: 0, y: 0, z: 0 },
        width: 50, height: 50, color: 0x4a7c4f,
        receiveShadow: true,
        userData: { physics: { bodyType: "fixed", collider: "cuboid", friction: 0.8 } },
      });
      await sendCommand("addObject", {
        objectType: "hemisphereLight", name: "Sky Light",
        skyColor: 0x87ceeb, groundColor: 0x362907, intensity: 0.6,
      });
      await sendCommand("addObject", {
        objectType: "directionalLight", name: "Sun",
        intensity: 1, position: { x: 10, y: 20, z: 10 },
      });
      // Add some obstacles with physics
      await sendCommand("addObject", {
        objectType: "box", name: "Crate 1",
        position: { x: 3, y: 0.5, z: -3 },
        color: 0x8B4513,
        castShadow: true,
        userData: { physics: { bodyType: "dynamic", collider: "cuboid", friction: 0.6 } },
      });
      await sendCommand("addObject", {
        objectType: "box", name: "Crate 2",
        position: { x: -2, y: 0.5, z: -5 },
        color: 0x8B4513,
        castShadow: true,
        userData: { physics: { bodyType: "dynamic", collider: "cuboid", friction: 0.6 } },
      });
      await sendCommand("addObject", {
        objectType: "sphere", name: "Ball",
        radius: 0.5,
        position: { x: 5, y: 1, z: 0 },
        color: 0xff4444,
        castShadow: true,
        userData: { physics: { bodyType: "dynamic", collider: "sphere", radius: 0.5, restitution: 0.7 } },
      });
      // Spawn character
      await sendCommand("spawnCharacter", {
        name: "Player",
        position: { x: 0, y: 1.5, z: 0 },
        color: 0x4488ff,
      });
      reply = "Game scene ready! Ground, lights, obstacles, and player character. Type 'play' then click the viewport and use WASD to move, mouse to look, Space to jump, Shift to run.";
    } else if (lower === "add character" || lower === "spawn character") {
      await sendCommand("spawnCharacter", {
        name: "Player",
        position: { x: 0, y: 1.5, z: 0 },
        color: 0x4488ff,
      });
      reply = "Player character spawned with physics. Use 'play' to test WASD movement (click viewport for mouse look).";
    } else if (lower === "get scene" || lower === "export") {
      const scene = await sendCommand("getScene");
      reply = "Scene JSON exported. Check console for data.";
      console.log("Scene JSON:", scene);
    } else {
      reply = `Commands: play, stop, clear, list, add [box/sphere/plane/capsule/light], setup scene, add character, get scene`;
    }

    setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
  }, [chatInput, sendCommand]);

  const filteredAssets = DUMMY_ASSETS.filter((a) => {
    if (category !== "All" && a.category !== category) return false;
    if (searchQuery && !a.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-900">
      {/* Left Panel */}
      {panelOpen && (
        <div className="flex flex-col w-72 min-w-72 border-r border-zinc-700 bg-zinc-900">
          {/* Tab bar */}
          <div className="flex border-b border-zinc-700">
            <button
              onClick={() => setTab("assets")}
              className={`flex-1 py-2 text-sm font-medium ${
                tab === "assets"
                  ? "text-white border-b-2 border-blue-500"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Assets
            </button>
            <button
              onClick={() => setTab("ai")}
              className={`flex-1 py-2 text-sm font-medium ${
                tab === "ai"
                  ? "text-white border-b-2 border-blue-500"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              AI Chat
            </button>
          </div>

          {/* Assets tab */}
          {tab === "assets" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="p-2">
                <input
                  type="text"
                  placeholder="Search assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-800 text-white text-sm rounded border border-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-1 px-2 pb-2 flex-wrap">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-2 py-0.5 text-xs rounded ${
                      category === cat
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 auto-rows-min">
                {filteredAssets.map((asset, i) => (
                  <button
                    key={i}
                    onClick={() => addAssetToScene(asset)}
                    className="flex flex-col items-center p-3 bg-zinc-800 rounded-lg border border-zinc-700 hover:border-blue-500 hover:bg-zinc-750 transition-colors cursor-pointer"
                  >
                    <span className="text-2xl mb-1">{asset.thumbnail}</span>
                    <span className="text-xs text-zinc-300 text-center leading-tight">
                      {asset.name}
                    </span>
                    <span className="text-[10px] text-zinc-500">{asset.category}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI Chat tab */}
          {tab === "ai" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-sm p-2 rounded ${
                      msg.role === "user"
                        ? "bg-blue-900/50 text-blue-100 ml-4"
                        : msg.role === "system"
                        ? "bg-zinc-800 text-zinc-400 text-xs"
                        : "bg-zinc-800 text-zinc-200 mr-4"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t border-zinc-700">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type a command..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChatSubmit()}
                    className="flex-1 px-3 py-1.5 bg-zinc-800 text-white text-sm rounded border border-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={handleChatSubmit}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toggle panel button */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="absolute left-0 top-1/2 z-10 bg-zinc-700 text-white px-1 py-4 rounded-r hover:bg-zinc-600"
        style={{ left: panelOpen ? "288px" : "0px" }}
      >
        {panelOpen ? "◀" : "▶"}
      </button>

      {/* Editor iframe */}
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          src="/editor/index.html"
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; xr-spatial-tracking"
        />
      </div>
    </div>
  );
}
