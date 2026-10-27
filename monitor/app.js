const $ = (selector) => document.querySelector(selector);
const pairingKey = "quiet-desktop-pairing";
const token = location.hash.slice(1) || sessionStorage.getItem(pairingKey);
if (token) sessionStorage.setItem(pairingKey, token);
history.replaceState(null, "", location.pathname);
let socket, noticeTimer, pendingFrame;
let state = {},
  streaming = true,
  drawing = false,
  lastFrame = 0,
  frames = [],
  metrics = "",
  tabsKey = "",
  actionsKey = "";
let preferredFps = Number(sessionStorage.getItem("quiet-desktop-fps")) || 60;
const canvas = $("#desktop-frame");
const bitmapContext = canvas.getContext("bitmaprenderer");
const send = (value) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
};
const iconPath = (name) => "/icons/" + name + ".svg";
function notice(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("#notice").hidden = true;
  }, 6000);
}
function fitFrame() {
  if ($("#frame-group").hidden) return;
  const stage = $("#stage"),
    style = getComputedStyle(stage);
  const actual = stage.classList.contains("actual");
  const width =
    stage.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const height =
    stage.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  const scale = actual
    ? 1
    : Math.max(0.01, Math.min(width / canvas.width, height / canvas.height));
  $("#frame-group").style.width = Math.floor(canvas.width * scale) + "px";
  $("#frame-group").style.height = Math.floor(canvas.height * scale) + "px";
}
new ResizeObserver(fitFrame).observe($("#stage"));
function setScale(actual) {
  $("#stage").classList.toggle("actual", actual);
  $("#fit").textContent = actual ? "100%" : "Fit";
  $("#fit").setAttribute("aria-pressed", !actual);
  $("#scale").value = actual ? "actual" : "fit";
  fitFrame();
}
function panel(name, open) {
  if (open && innerWidth < 1000) {
    const other = name === "layers" ? "inspector" : "layers";
    $("#app").classList.add(other + "-hidden");
    $("#" + other + "-toggle").setAttribute("aria-expanded", false);
  }
  $("#app").classList.toggle(name + "-hidden", !open);
  $(
    "#" + (name === "layers" ? "layers" : "inspector") + "-toggle",
  ).setAttribute("aria-expanded", open);
  window.dispatchEvent(new Event("panelschange"));
}
panel("layers", false);
panel("inspector", false);
matchMedia("(max-width:760px)").addEventListener("change", (event) => {
  if (event.matches) {
    panel("layers", false);
    panel("inspector", false);
  }
});
function inspector(name) {
  panel("inspector", true);
  if (innerWidth <= 760) panel("layers", false);
  for (const button of document.querySelectorAll("[data-inspector]")) {
    const selected = button.dataset.inspector === name;
    button.setAttribute("aria-selected", selected);
    button.tabIndex = selected ? 0 : -1;
    $("#" + button.dataset.inspector + "-properties").hidden = !selected;
  }
}
function view(name) {
  $("#desktop-view").hidden = name !== "desktop";
  $("#activity-view").hidden = name !== "activity";
  for (const button of document.querySelectorAll("[data-view]")) {
    const selected = button.dataset.view === name;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  send({
    type: "stream",
    enabled: streaming && name === "desktop" && !document.hidden,
  });
  if (name === "desktop") fitFrame();
}
function activityRows(actions) {
  const key = JSON.stringify(actions);
  if (key === actionsKey) return;
  actionsKey = key;
  const target = $("#activity-list");
  target.replaceChildren();
  if (!actions.length) {
    const empty = document.createElement("p");
    empty.className = "activity-empty";
    empty.textContent = "No activity yet";
    target.append(empty);
    return;
  }
  const labels = {
    open: "Opened a tab",
    read: "Read the page",
    click: "Activated an element",
    fill: "Filled a field",
    select: "Selected an option",
    wait: "Checked page content",
    navigate: "Navigated to a page",
    close: "Closed a tab",
    pause: "Agent paused",
    resume: "Agent resumed",
    "pointer-move": "Moved the pointer",
    "pointer-click": "Clicked with the pointer",
  };
  for (const action of actions) {
    const row = document.createElement("div");
    row.className = "action-row";
    const icon = document.createElement("img");
    icon.className = "icon action-icon";
    icon.alt = action.ok ? "Succeeded" : "Failed";
    icon.src = iconPath(action.ok ? "check" : "warning-circle");
    const label = document.createElement("span");
    label.className = "action-label";
    label.textContent = labels[action.action] || action.action;
    const time = document.createElement("time");
    time.className = "action-time";
    time.dateTime = action.at;
    time.textContent = new Date(action.at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    row.append(icon, label, time);
    target.append(row);
  }
}
function renderTabs(tabs) {
  const key = JSON.stringify([tabs, state.activeTab]);
  if (key === tabsKey) return;
  tabsKey = key;
  $("#tab-picker").replaceChildren();
  $("#tab-list").replaceChildren();
  if (!tabs.length) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "No tabs open";
    $("#tab-list").append(empty);
  }
  for (const tab of tabs) {
    let label = "Agent tab";
    try {
      const url = new URL(tab.url);
      label = url.hostname.replace(/^www\./, "") || "Blank tab";
    } catch {}
    const option = document.createElement("option");
    option.value = tab.id;
    option.textContent = label;
    option.selected = tab.id === state.activeTab;
    $("#tab-picker").append(option);
    const row = document.createElement("button");
    row.className = "tab-row";
    row.classList.toggle("selected", tab.id === state.activeTab);
    row.setAttribute("aria-pressed", tab.id === state.activeTab);
    row.title = tab.url;
    const icon = document.createElement("img");
    icon.className = "icon";
    icon.src = iconPath("browser");
    icon.alt = "";
    const name = document.createElement("span");
    name.textContent = label;
    row.append(icon, name);
    row.onclick = () => {
      send({ type: "select-tab", id: tab.id });
      view("desktop");
    };
    $("#tab-list").append(row);
  }
  $("#tab-picker").disabled = tabs.length < 2;
  $("#tab-location").textContent =
    tabs.find((tab) => tab.id === state.activeTab)?.url ||
    tabs.at(-1)?.url ||
    "No tab selected";
}
function render(next) {
  state = next;
  if (state.targetFps) $("#frame-rate").value = String(state.targetFps);
  const status = !state.connected
    ? "Offline"
    : !state.running
      ? "Not started"
      : state.paused
        ? "Paused"
        : "Running";
  $("#agent-state").textContent = status;
  $("#session-agent-state").textContent = status;
  $("#agent-dot").className =
    "dot " + (state.running ? (state.paused ? "paused" : "live") : "");
  $("#bridge-dot").className = "dot " + (state.connected ? "live" : "");
  $("#bridge-state").textContent = state.connected
    ? "Bridge connected"
    : "Bridge offline";
  const sessions = state.importedSession
    ? state.importedSession.domainCount + (state.importedSession.domainCount === 1 ? " domain authorized" : " domains authorized")
    : "No sessions imported";
  $("#session-state").textContent = sessions;
  $("#session-domains").textContent = sessions;
  $("#session-connection").textContent = state.connected ? "Local" : "Offline";
  const tabs = state.tabs || [];
  $("#tab-count").textContent = tabs.length;
  $("#session-tab-count").textContent = tabs.length;
  renderTabs(tabs);
  $("#agent-toggle").disabled = !state.connected || !state.running;
  $("#agent-toggle span").textContent = state.paused
    ? "Resume agent"
    : "Pause agent";
  $("#agent-toggle img").src = iconPath(state.paused ? "play" : "pause");
  $("#pin").disabled = !state.canPin;
  $("#pin").setAttribute("aria-pressed", Boolean(state.pinned));
  if (!state.running) {
    $("#frame-group").hidden = true;
    $("#empty").hidden = false;
    $("#empty-title").textContent = state.connected
      ? "No desktop running"
      : "Local bridge offline";
    $("#empty-detail").textContent = state.connected
      ? "Authorize sessions in the Edge extension to start."
      : "Start the local bridge to reconnect.";
  }
  activityRows([...(state.recentActions || [])].reverse());
  renderStream();
}
function renderStream() {
  const live =
    streaming &&
    state.running &&
    state.connected &&
    Date.now() - lastFrame < 3000;
  $("#stream-dot").className =
    "dot " + (live ? "live" : !streaming ? "paused" : "");
  $("#stream-state").textContent = !streaming
    ? "Preview paused"
    : live
      ? "Live"
      : !state.running
        ? "Offline"
        : "Waiting for frame";
  $("#stream-toggle").disabled = !state.running;
  const label = streaming ? "Pause preview" : "Resume preview";
  $("#stream-toggle").setAttribute("aria-label", label);
  $("#stream-toggle").title = label;
  $("#stream-toggle img").src = iconPath(streaming ? "pause" : "play");
  $("#stream-overlay").hidden = streaming || !lastFrame;
  $("#frame-metrics").textContent = live ? metrics : "";
}
function connect() {
  if (!token) {
    notice("Open this window using Preview.cmd to connect to your agent.");
    return;
  }
  socket = new WebSocket("ws://" + location.host + "/watch");
  socket.onopen = () => {
    send({ type: "hello", token, protocol: 2 });
    send({ type: "quality", fps: preferredFps === 30 ? 30 : 60 });
    send({
      type: "stream",
      enabled: streaming && !document.hidden && !$("#desktop-view").hidden,
    });
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") {
      pendingFrame = event.data;
      if (!drawing) drawFrames();
      return;
    }
    const message = JSON.parse(event.data);
    if (message.type === "state") render(message.state);
    if (message.type === "notice") notice(message.message);
  };
  socket.onclose = () => {
    render({ ...state, connected: false });
    setTimeout(connect, 2000);
  };
  socket.onerror = () => {};
}
async function drawFrames() {
  drawing = true;
  try {
    while (pendingFrame) {
      const frame = pendingFrame;
      pendingFrame = null;
      const header = new DataView(await frame.slice(0, 8).arrayBuffer());
      const bitmap = await createImageBitmap(
        frame.slice(8, frame.size, "image/jpeg"),
      );
      if (pendingFrame) {
        bitmap.close();
        continue;
      }
      await new Promise(requestAnimationFrame);
      const resized =
        canvas.width !== bitmap.width || canvas.height !== bitmap.height;
      if (resized) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      bitmapContext.transferFromImageBitmap(bitmap);
      const wasHidden = $("#frame-group").hidden;
      $("#frame-group").hidden = false;
      $("#empty").hidden = true;
      if (resized || wasHidden) fitFrame();
      lastFrame = Date.now();
      frames.push(lastFrame);
      frames = frames.filter((at) => lastFrame - at < 3000);
      const rate =
        frames.length > 1
          ? (
              ((frames.length - 1) * 1000) /
              (frames.at(-1) - frames[0])
            ).toFixed(1)
          : "—";
      metrics = rate + " fps";
      $("#resolution").textContent =
        header.getUint16(4) + " × " + header.getUint16(6);
      $("#delivered-fps").textContent = metrics;
      renderStream();
    }
  } catch {
    notice("A preview frame could not be decoded.");
  } finally {
    drawing = false;
  }
}
for (const button of document.querySelectorAll("[data-view]"))
  button.onclick = () => view(button.dataset.view);
for (const button of document.querySelectorAll("[data-inspector]")) {
  button.onclick = () => inspector(button.dataset.inspector);
  button.onkeydown = (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const name =
        button.dataset.inspector === "preview" ? "session" : "preview";
      inspector(name);
      $("#" + name + "-tab").focus();
    }
  };
}
$("#show-session").onclick = () => inspector("session");
$("#inspector-close").onclick = () => panel("inspector", false);
$("#agent-workspace").onclick = () => view("desktop");
$("#layers-close").onclick = () => panel("layers", false);
$("#layers-toggle").onclick = () => {
  const open = $("#app").classList.contains("layers-hidden");
  panel("layers", open);
  if (open && innerWidth <= 760) panel("inspector", false);
};
$("#inspector-toggle").onclick = () => {
  const open = $("#app").classList.contains("inspector-hidden");
  panel("inspector", open);
  if (open && innerWidth <= 760) panel("layers", false);
};
$("#agent-toggle").onclick = () => {
  $("#agent-toggle").disabled = true;
  send({ type: "agent", action: state.paused ? "resume" : "pause" });
};
$("#pin").onclick = () => send({ type: "pin", enabled: !state.pinned });
$("#stream-toggle").onclick = () => {
  streaming = !streaming;
  send({
    type: "stream",
    enabled: streaming && !document.hidden && !$("#desktop-view").hidden,
  });
  renderStream();
};
$("#fit").onclick = () => setScale(!$("#stage").classList.contains("actual"));
$("#scale").onchange = (event) => setScale(event.target.value === "actual");
$("#fullscreen").onclick = () => {
  const request = document.fullscreenElement
    ? document.exitFullscreen()
    : $("#desktop-view").requestFullscreen();
  request.catch(() => notice("Full screen is unavailable in this window."));
};
$("#tab-picker").onchange = (event) =>
  send({ type: "select-tab", id: event.target.value });
$("#frame-rate").onchange = (event) => {
  preferredFps = Number(event.target.value);
  sessionStorage.setItem("quiet-desktop-fps", event.target.value);
  send({ type: "quality", fps: preferredFps });
};
document.addEventListener("visibilitychange", () =>
  send({
    type: "stream",
    enabled: streaming && !document.hidden && !$("#desktop-view").hidden,
  }),
);
setInterval(renderStream, 1000);
setInterval(() => send({ type: "ping" }), 15000);
connect();

function options(open) {
  $("#options-menu").hidden = !open;
  $("#options-toggle").setAttribute("aria-expanded", open);
}
$("#options-toggle").onclick = () => options($("#options-menu").hidden);
$("#options-menu").addEventListener("click", (event) => {
  if (event.target.closest("button")) options(false);
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".canvas-toolbar")) options(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#options-menu").hidden) {
    options(false);
    $("#options-toggle").focus();
  }
});
$("#open-mini").onclick = async () => {
  try {
    const response = await fetch("/mini", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error();
  } catch {
    notice("The mini control could not open.");
  }
};
for (const [name, initial, minimum, maximum, direction] of [
  ["layers", 240, 190, 420, 1],
  ["inspector", 280, 250, 420, -1],
]) {
  const handle = $("#" + name + "-resize");
  const key = "quiet-desktop-" + name + "-width";
  let width = initial,
    start;
  function resize(value) {
    const other = name === "layers" ? "inspector" : "layers";
    const otherWidth = $("#app").classList.contains(other + "-hidden")
      ? 0
      : $("." + other + "-panel").getBoundingClientRect().width;
    const limit = Math.max(
      minimum,
      Math.min(maximum, innerWidth - 320 - otherWidth),
    );
    width = Math.max(minimum, Math.min(limit, value));
    $("#app").style.setProperty("--" + name + "-width", width + "px");
    handle.setAttribute("aria-valuemin", minimum);
    handle.setAttribute("aria-valuemax", limit);
    handle.setAttribute("aria-valuenow", width);
  }
  try {
    resize(Number(localStorage.getItem(key)) || initial);
  } catch {
    resize(initial);
  }
  const save = () => {
    try {
      localStorage.setItem(key, width);
    } catch {}
  };
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start = { x: event.clientX, width };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
  };
  handle.onpointermove = (event) => {
    if (start) resize(start.width + direction * (event.clientX - start.x));
  };
  handle.onlostpointercapture = () => {
    start = null;
    document.body.classList.remove("resizing");
    save();
  };
  handle.onpointerup = (event) => {
    if (handle.hasPointerCapture(event.pointerId))
      handle.releasePointerCapture(event.pointerId);
  };
  handle.onpointercancel = handle.onpointerup;
  handle.ondblclick = () => {
    resize(initial);
    save();
  };
  handle.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    resize(
      event.key === "Home"
        ? minimum
        : event.key === "End"
          ? maximum
          : width + direction * (event.key === "ArrowRight" ? 10 : -10),
    );
    save();
  };
  window.addEventListener("resize", () => resize(width));
  window.addEventListener("panelschange", () => resize(width));
}
