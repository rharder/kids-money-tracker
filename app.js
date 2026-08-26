const STORAGE_KEY = "familyMoneyTracker.v3";
const PREVIOUS_KEYS = ["familyMoneyTracker.v2", "familyMoneyTracker.v1"];
const categories = ["Short Term", "Long Term", "Very Long Term"];
const activeCategories = ["Short Term", "Long Term"];
const categoryIcons = { "Short Term": "↗", "Long Term": "◆", "Very Long Term": "⌁" };
const accents = ["#dff4e8", "#ddecff", "#ffe4dc", "#fff0bd", "#eadffc", "#d9f1ef"];

let state = loadState();
let selectedKidId = null;
let toastTimer;
let dragState = null;

const homeView = document.getElementById("homeView");
const detailView = document.getElementById("detailView");
const balanceView = document.getElementById("balanceView");
const kidsGrid = document.getElementById("kidsGrid");
const balanceEditorList = document.getElementById("balanceEditorList");
const balanceSaveBar = document.getElementById("balanceSaveBar");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");
const restoreInput = document.getElementById("restoreInput");

function loadState() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      if (!Array.isArray(parsed.kids) || !Array.isArray(parsed.transactions)) throw new Error("Invalid data");
      parsed.schemaVersion = 3;
      return parsed;
    }
    const legacyRaw = PREVIOUS_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    const parsed = legacyRaw ? JSON.parse(legacyRaw) : { schemaVersion: 3, kids: [], transactions: [] };
    if (!Array.isArray(parsed.kids) || !Array.isArray(parsed.transactions)) throw new Error("Invalid data");
    if (legacyRaw) {
      migrateLegacyState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return { schemaVersion: 3, kids: [], transactions: [] };
  }
}

function migrateLegacyState(data) {
  const categoryMigration = { Pocket: "Short Term", "Short Term": "Long Term", "Long Term": "Very Long Term" };
  data.transactions = data.transactions.map((transaction) => ({ ...transaction, category: categoryMigration[transaction.category] || transaction.category }));
  data.schemaVersion = 3;
  return data;
}

function persist(message) {
  state.schemaVersion = 3;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (message) showToast(message);
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function balance(kidId, category) {
  return state.transactions
    .filter((transaction) => transaction.kidId === kidId && transaction.category === category)
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
}

function kidTotal(kidId) {
  return activeCategories.reduce((total, category) => total + balance(kidId, category), 0);
}

function initials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function attr(value) {
  return escapeHtml(value);
}

function uniqueId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function render() {
  renderHome();
  if (selectedKidId) renderDetail();
  if (!balanceView.classList.contains("hidden")) renderBalanceEditor();
}

function renderHome() {
  const total = state.kids.reduce((sum, kid) => sum + kidTotal(kid.id), 0);
  document.getElementById("familyTotal").textContent = money(total);
  document.getElementById("kidCount").textContent = String(state.kids.length);
  document.getElementById("transactionCount").textContent = String(state.transactions.length);
  document.getElementById("familySummary").hidden = state.kids.length === 0;

  if (!state.kids.length) {
    kidsGrid.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>Ready for the first money lesson?</h3>
          <p>Add a child, see their everyday money, and divide weekly pay into five equal shares.</p>
          <button class="primary" type="button" data-action="add-kid" style="margin-top:18px">Add your first child</button>
        </div>
        <div class="empty-icon" aria-hidden="true">✦</div>
      </div>`;
    return;
  }

  kidsGrid.innerHTML = state.kids.map((kid, index) => `
    <article class="kid-card" data-kid-id="${attr(kid.id)}" style="--card-accent:${accents[index % accents.length]}">
      <button class="kid-card-open" type="button" data-open-kid="${attr(kid.id)}" aria-label="View ${attr(kid.name)} details and Very Long Term savings">
        <div class="kid-top">
          <div class="kid-identity">
            <div class="avatar">${escapeHtml(initials(kid.name))}</div>
            <div><h3 class="kid-name">${escapeHtml(kid.name)}</h3><span>View savings details</span></div>
          </div>
          <span class="arrow" aria-hidden="true">→</span>
        </div>
        <div class="balances">
          ${activeCategories.map((category) => `<div class="balance"><span>${escapeHtml(category)}</span><strong>${money(balance(kid.id, category))}</strong></div>`).join("")}
        </div>
      </button>
      <div class="card-actions">
        <button class="card-action spend" type="button" data-action="quick-spend" data-target-kid="${attr(kid.id)}" aria-label="Record spending for ${attr(kid.name)}">− Spend</button>
        <button class="card-action weekly" type="button" data-action="quick-pay" data-target-kid="${attr(kid.id)}" aria-label="Add weekly pay for ${attr(kid.name)}">＋ Pay</button>
      </div>
      <button class="drag-handle" type="button" data-reorder-kid="${attr(kid.id)}" aria-label="Reorder ${attr(kid.name)}. Drag, or use arrow keys to move." title="Drag to reorder"><span aria-hidden="true">⠿</span></button>
    </article>`).join("");
}

function renderBalanceEditor() {
  balanceSaveBar.hidden = state.kids.length === 0;
  if (!state.kids.length) {
    balanceEditorList.innerHTML = `<div class="empty-state"><div><h3>Add a child first</h3><p>Once a child exists, their Short Term, Long Term, and Very Long Term balances can be entered here.</p><button class="primary" type="button" data-action="add-kid" style="margin-top:18px">Add child</button></div><div class="empty-icon" aria-hidden="true">✦</div></div>`;
    return;
  }

  balanceEditorList.innerHTML = state.kids.map((kid, index) => `
    <section class="balance-edit-row" data-balance-kid="${attr(kid.id)}" style="--card-accent:${accents[index % accents.length]}">
      <div class="balance-edit-kid"><div class="avatar">${escapeHtml(initials(kid.name))}</div><strong>${escapeHtml(kid.name)}</strong></div>
      <div class="balance-edit-fields">
        ${categories.map((category) => `<label><span>${escapeHtml(category)}</span><input type="number" step="0.01" inputmode="decimal" value="${balance(kid.id, category).toFixed(2)}" data-balance-category="${attr(category)}" aria-label="${attr(kid.name)} ${attr(category)} balance"${category === "Very Long Term" ? " min=\"0\"" : ""} required></label>`).join("")}
      </div>
    </section>`).join("");
}

function showBalanceEditor() {
  selectedKidId = null;
  homeView.classList.add("hidden");
  detailView.classList.add("hidden");
  balanceView.classList.remove("hidden");
  renderBalanceEditor();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function orderedKidIds() {
  return [...kidsGrid.querySelectorAll(".kid-card")].map((card) => card.dataset.kidId);
}

function saveKidOrder(ids, message = "Order updated") {
  const kidsById = new Map(state.kids.map((kid) => [kid.id, kid]));
  state.kids = ids.map((id) => kidsById.get(id)).filter(Boolean);
  persist(message);
}

function moveKidWithKeyboard(id, direction) {
  const ids = state.kids.map((kid) => kid.id);
  const fromIndex = ids.indexOf(id);
  const toIndex = Math.max(0, Math.min(ids.length - 1, fromIndex + direction));
  if (fromIndex < 0 || fromIndex === toIndex) return;
  ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
  const kidName = state.kids.find((kid) => kid.id === id)?.name || "Child";
  saveKidOrder(ids, `${kidName} moved ${direction < 0 ? "up" : "down"}`);
  requestAnimationFrame(() => kidsGrid.querySelector(`[data-reorder-kid="${CSS.escape(id)}"]`)?.focus());
}

function startKidDrag(event, handle) {
  if (event.button !== undefined && event.button !== 0) return;
  const card = handle.closest(".kid-card");
  if (!card) return;
  event.preventDefault();
  dragState = { card, handle, pointerId: event.pointerId, originalIds: orderedKidIds(), moved: false };
  handle.setPointerCapture?.(event.pointerId);
  handle.classList.add("dragging");
  card.classList.add("dragging");
  kidsGrid.classList.add("is-sorting");
}

function moveKidDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  event.preventDefault();
  const target = document.elementsFromPoint(event.clientX, event.clientY).map((element) => element.closest?.(".kid-card")).find((card) => card && card !== dragState.card);
  kidsGrid.querySelectorAll(".drop-before, .drop-after").forEach((card) => card.classList.remove("drop-before", "drop-after"));
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const singleColumn = getComputedStyle(kidsGrid).gridTemplateColumns.split(" ").length === 1;
  const before = singleColumn
    ? event.clientY < rect.top + rect.height / 2
    : event.clientY < rect.top + rect.height * .25 || (event.clientY <= rect.bottom - rect.height * .25 && event.clientX < rect.left + rect.width / 2);

  target.classList.add(before ? "drop-before" : "drop-after");
  target[before ? "before" : "after"](dragState.card);
  dragState.moved = true;

  const edge = 70;
  if (event.clientY < edge) window.scrollBy({ top: -10 });
  if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 10 });
}

function finishKidDrag(event, cancelled = false) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const { card, handle, pointerId, originalIds, moved } = dragState;
  handle.releasePointerCapture?.(pointerId);
  handle.classList.remove("dragging");
  card.classList.remove("dragging");
  kidsGrid.classList.remove("is-sorting");
  kidsGrid.querySelectorAll(".drop-before, .drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
  dragState = null;
  if (cancelled) return renderHome();
  const ids = orderedKidIds();
  if (moved && ids.some((id, index) => id !== originalIds[index])) saveKidOrder(ids);
}

function renderDetail() {
  const kid = state.kids.find((item) => item.id === selectedKidId);
  if (!kid) return showHome();
  const transactions = state.transactions
    .filter((transaction) => transaction.kidId === kid.id)
    .sort((a, b) => b.time - a.time);

  document.getElementById("kidDetail").innerHTML = `
    <div class="detail-hero">
      <div class="detail-title-row">
        <div class="avatar">${escapeHtml(initials(kid.name))}</div>
        <div><p class="eyebrow">Money dashboard</p><h1 id="detailName">${escapeHtml(kid.name)}</h1></div>
      </div>
      <div class="detail-actions">
        <button class="secondary" type="button" data-action="rename">Rename</button>
        <button class="danger" type="button" data-action="delete-kid">Delete</button>
      </div>
      <div class="detail-balances">
        ${activeCategories.map((category) => `<div class="detail-balance"><span>${escapeHtml(category)}</span><strong>${money(balance(kid.id, category))}</strong></div>`).join("")}
      </div>
    </div>
    <div class="quick-actions">
      <button class="quick-action primary" type="button" data-action="adjust"><span>Record spending<small>Short Term or Long Term</small></span><span class="quick-action-icon">−</span></button>
      <button class="quick-action secondary" type="button" data-action="pay"><span>Add weekly pay<small>Divide into five equal shares</small></span><span class="quick-action-icon">＋</span></button>
    </div>
    <section class="vault-card" aria-labelledby="vaultTitle">
      <div class="vault-icon" aria-hidden="true">⌁</div>
      <div class="vault-copy"><p class="eyebrow">Quiet savings</p><h2 id="vaultTitle">Very Long Term</h2><p>This money only grows. It stays tucked away until around age 18.</p></div>
      <strong>${money(balance(kid.id, "Very Long Term"))}</strong>
    </section>
    <div class="history-card">
      <div class="history-head"><div><h2>Activity</h2><p>${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}</p></div><button class="secondary" type="button" data-action="backup">Backup</button></div>
      <div>
        ${transactions.length ? transactions.map((transaction) => `
          <div class="transaction">
            <div class="tx-icon" aria-hidden="true">${categoryIcons[transaction.category] || "•"}</div>
            <div class="tx-copy"><strong>${escapeHtml(transaction.note || transaction.category)}</strong><small>${escapeHtml(transaction.category)} · ${new Date(transaction.time).toLocaleString()}</small></div>
            <div class="tx-amount ${transaction.amount >= 0 ? "plus" : "minus"}">${transaction.amount >= 0 ? "+" : "−"}${money(Math.abs(transaction.amount))}</div>
          </div>`).join("") : `<div class="empty-history">No activity yet. Add weekly pay to get started.</div>`}
      </div>
    </div>`;
}

function openKid(id) {
  selectedKidId = id;
  homeView.classList.add("hidden");
  balanceView.classList.add("hidden");
  detailView.classList.remove("hidden");
  renderDetail();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
  selectedKidId = null;
  detailView.classList.add("hidden");
  balanceView.classList.add("hidden");
  homeView.classList.remove("hidden");
  renderHome();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(content) {
  modalBody.innerHTML = `<div class="modal-content">${content}</div>`;
  modal.showModal();
  requestAnimationFrame(() => modal.querySelector("input:not([type=file]), select")?.focus());
}

function closeModal() {
  modal.close();
}

function closeButton() {
  return `<button class="modal-close" type="button" data-action="close" aria-label="Close">×</button>`;
}

function openAddKid() {
  openModal(`${closeButton()}<h2 id="modalTitle">Add a child</h2><p class="modal-copy">Create a money dashboard just for them.</p><form id="addKidForm"><label for="kidName">Name</label><input id="kidName" name="name" maxlength="40" autocomplete="off" required placeholder="First name"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Add child</button></div></form>`);
}

function openRename() {
  const kid = state.kids.find((item) => item.id === selectedKidId);
  openModal(`${closeButton()}<h2 id="modalTitle">Rename child</h2><form id="renameForm"><label for="kidName">Name</label><input id="kidName" name="name" maxlength="40" value="${attr(kid.name)}" required><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save name</button></div></form>`);
}

function openPay() {
  openModal(`${closeButton()}<h2 id="modalTitle">Add weekly pay</h2><p class="modal-copy">The total is divided into five equal shares. Pocket and Tithe stay untracked; the three savings shares are added here.</p><form id="payForm"><label for="payAmount">Total earned</label><input id="payAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="25.00" required><div id="splitPreview" class="split-preview" hidden></div><label for="payNote">Note <span style="font-weight:400">(optional)</span></label><input id="payNote" name="note" maxlength="80" placeholder="Weekly jobs"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Divide & add</button></div></form>`);
}

function updateSplitPreview(input) {
  const cents = Math.round(Number(input.value) * 100);
  const preview = document.getElementById("splitPreview");
  if (!cents || cents < 1) return preview.hidden = true;
  const shares = splitCents(cents);
  preview.hidden = false;
  preview.innerHTML = categories.map((category, index) => `<div><span>${escapeHtml(category)}</span><strong>${money(shares[index + 2] / 100)}</strong></div>`).join("");
}

function splitCents(totalCents) {
  const base = Math.floor(totalCents / 5);
  const shares = [base, base, base, base, base];
  for (let index = 0; index < totalCents - base * 5; index += 1) shares[index] += 1;
  return shares;
}

function openAdjust() {
  openModal(`${closeButton()}<h2 id="modalTitle">Record spending</h2><p class="modal-copy">Update Short Term or Long Term money.</p><form id="adjustForm"><fieldset class="choice-field"><legend>Money bucket</legend><div class="segmented">${activeCategories.map((category, index) => `<label><input type="radio" name="category" value="${escapeHtml(category)}"${index === 0 ? " checked" : ""}><span>${escapeHtml(category)}</span></label>`).join("")}</div></fieldset><label for="adjustAmount">Amount</label><input id="adjustAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="5.00" required><fieldset class="choice-field"><legend>Type</legend><div class="segmented"><label><input type="radio" name="type" value="-1" checked><span>Spend</span></label><label><input type="radio" name="type" value="1"><span>Add money</span></label></div></fieldset><label for="adjustNote">Note <span style="font-weight:400">(optional)</span></label><input id="adjustNote" name="note" maxlength="80" placeholder="Bought a book"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save transaction</button></div></form>`);
}

function openBackup() {
  openModal(`${closeButton()}<h2 id="modalTitle">Keep your data safe</h2><p class="modal-copy">Your family's information lives only in this browser. Download a backup regularly so it can be restored later.</p><div class="backup-options"><button class="backup-option" type="button" data-action="download"><span>↓</span><span><strong>Download backup</strong><small>Save all kids, balances, and activity</small></span></button><button class="backup-option" type="button" data-action="restore"><span>↑</span><span><strong>Restore a backup</strong><small>Replace this device’s data from a JSON file</small></span></button></div>`);
}

function deleteKid() {
  const kid = state.kids.find((item) => item.id === selectedKidId);
  openModal(`${closeButton()}<h2 id="modalTitle">Delete ${escapeHtml(kid.name)}?</h2><p class="modal-copy">This permanently removes their balances and transaction history from this device. Download a backup first if you may need it later.</p><div class="modal-actions"><button class="secondary" type="button" data-action="close">Keep child</button><button class="danger" type="button" data-action="confirm-delete">Delete everything</button></div>`);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `family-money-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  closeModal();
  showToast("Backup downloaded");
}

async function restoreData(file) {
  try {
    let restored = JSON.parse(await file.text());
    if (!Array.isArray(restored.kids) || !Array.isArray(restored.transactions)) throw new Error("Invalid backup");
    if (restored.schemaVersion !== 3) restored = migrateLegacyState(restored);
    const validCategories = new Set(categories);
    if (restored.kids.some((kid) => !kid.id || typeof kid.name !== "string") || restored.transactions.some((tx) => !tx.id || !tx.kidId || !validCategories.has(tx.category) || !Number.isFinite(Number(tx.amount)) || !Number.isFinite(Number(tx.time)) || (tx.category === "Very Long Term" && Number(tx.amount) < 0 && tx.kind !== "balance-set"))) throw new Error("Invalid backup");
    state = restored;
    selectedKidId = null;
    closeModal();
    showHome();
    persist("Backup restored");
  } catch {
    showToast("That file isn’t a valid Family Money backup");
  } finally {
    restoreInput.value = "";
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  const action = actionTarget?.dataset.action;
  if (!action) {
    const kidOpen = event.target.closest("[data-open-kid]");
    if (kidOpen) return openKid(kidOpen.dataset.openKid);
    return;
  }
  const actions = {
    "add-kid": openAddKid,
    close: closeModal,
    rename: openRename,
    pay: openPay,
    adjust: openAdjust,
    "quick-spend": () => { selectedKidId = actionTarget.dataset.targetKid; openAdjust(); },
    "quick-pay": () => { selectedKidId = actionTarget.dataset.targetKid; openPay(); },
    backup: openBackup,
    download: exportData,
    restore: () => restoreInput.click(),
    "balance-cancel": showHome,
    "delete-kid": deleteKid,
    "confirm-delete": () => {
      state.kids = state.kids.filter((kid) => kid.id !== selectedKidId);
      state.transactions = state.transactions.filter((transaction) => transaction.kidId !== selectedKidId);
      closeModal();
      showHome();
      persist("Child and activity deleted");
    }
  };
  actions[action]?.();
});

document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-reorder-kid]");
  if (handle) startKidDrag(event, handle);
});
document.addEventListener("pointermove", moveKidDrag, { passive: false });
document.addEventListener("pointerup", (event) => finishKidDrag(event));
document.addEventListener("pointercancel", (event) => finishKidDrag(event, true));
document.addEventListener("keydown", (event) => {
  const handle = event.target.closest("[data-reorder-kid]");
  if (!handle) return;
  if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    moveKidWithKeyboard(handle.dataset.reorderKid, -1);
  }
  if (["ArrowDown", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    moveKidWithKeyboard(handle.dataset.reorderKid, 1);
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  if (form.id === "addKidForm") {
    state.kids.push({ id: uniqueId(), name: values.get("name").trim() });
    closeModal();
    persist("Child added");
  }
  if (form.id === "renameForm") {
    state.kids.find((kid) => kid.id === selectedKidId).name = values.get("name").trim();
    closeModal();
    persist("Name updated");
  }
  if (form.id === "payForm") {
    const totalCents = Math.round(Number(values.get("amount")) * 100);
    if (totalCents < 1) return;
    const shares = splitCents(totalCents);
    const note = values.get("note").trim() || `Weekly pay (${money(totalCents / 100)} total)`;
    categories.forEach((category, index) => state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category, amount: shares[index + 2] / 100, note, time: Date.now() + index }));
    closeModal();
    persist("Weekly pay divided and added");
  }
  if (form.id === "adjustForm") {
    const amount = Math.round(Number(values.get("amount")) * 100) / 100;
    if (amount < .01) return;
    state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category: values.get("category"), amount: amount * Number(values.get("type")), note: values.get("note").trim(), time: Date.now() });
    closeModal();
    persist("Transaction saved");
  }
  if (form.id === "setBalancesForm") {
    const changes = [];
    let invalid = false;
    form.querySelectorAll("[data-balance-kid]").forEach((row) => {
      const kidId = row.dataset.balanceKid;
      row.querySelectorAll("[data-balance-category]").forEach((input) => {
        const category = input.dataset.balanceCategory;
        const target = Math.round(Number(input.value) * 100) / 100;
        if (!Number.isFinite(target) || (category === "Very Long Term" && target < 0)) {
          invalid = true;
          return;
        }
        const difference = Math.round((target - balance(kidId, category)) * 100) / 100;
        if (Math.abs(difference) >= .01) changes.push({ kidId, category, amount: difference });
      });
    });
    if (invalid) return showToast("Enter a valid amount for every balance");
    if (!changes.length) return showToast("Balances already match");
    const now = Date.now();
    changes.forEach((change, index) => state.transactions.push({ id: uniqueId(), ...change, kind: "balance-set", note: "Balance set manually", time: now + index }));
    showHome();
    persist("Balances updated");
  }
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
modal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal();
});
modal.addEventListener("input", (event) => {
  if (event.target.id === "payAmount") updateSplitPreview(event.target);
});
restoreInput.addEventListener("change", () => restoreInput.files[0] && restoreData(restoreInput.files[0]));
document.getElementById("addKidButton").addEventListener("click", openAddKid);
document.getElementById("setBalancesButton").addEventListener("click", showBalanceEditor);
document.getElementById("backupButton").addEventListener("click", openBackup);
document.getElementById("footerBackupButton").addEventListener("click", openBackup);
document.getElementById("backButton").addEventListener("click", showHome);
document.getElementById("balanceBackButton").addEventListener("click", showHome);

render();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
