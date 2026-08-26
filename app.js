const STORAGE_KEY = "familyMoneyTracker.v2";
const LEGACY_KEY = "familyMoneyTracker.v1";
const categories = ["Pocket", "Short Term", "Long Term"];
const categoryIcons = { Pocket: "◉", "Short Term": "↗", "Long Term": "◆" };
const accents = ["#dff4e8", "#ddecff", "#ffe4dc", "#fff0bd", "#eadffc", "#d9f1ef"];

let state = loadState();
let selectedKidId = null;
let toastTimer;

const homeView = document.getElementById("homeView");
const detailView = document.getElementById("detailView");
const kidsGrid = document.getElementById("kidsGrid");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");
const restoreInput = document.getElementById("restoreInput");

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    const parsed = raw ? JSON.parse(raw) : { kids: [], transactions: [] };
    if (!Array.isArray(parsed.kids) || !Array.isArray(parsed.transactions)) throw new Error("Invalid data");
    return parsed;
  } catch {
    return { kids: [], transactions: [] };
  }
}

function persist(message) {
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
  return categories.reduce((total, category) => total + balance(kidId, category), 0);
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
          <p>Add a child, record a job payment, and we’ll divide it into five equal shares.</p>
          <button class="primary" type="button" data-action="add-kid" style="margin-top:18px">Add your first child</button>
        </div>
        <div class="empty-icon" aria-hidden="true">✦</div>
      </div>`;
    return;
  }

  kidsGrid.innerHTML = state.kids.map((kid, index) => `
    <article class="kid-card" role="button" tabindex="0" data-kid-id="${attr(kid.id)}" style="--card-accent:${accents[index % accents.length]}">
      <div class="kid-top">
        <div class="avatar">${escapeHtml(initials(kid.name))}</div>
        <span class="arrow" aria-hidden="true">→</span>
      </div>
      <h3 class="kid-name">${escapeHtml(kid.name)}</h3>
      <p class="kid-total-label">Total balance</p>
      <div class="kid-total">${money(kidTotal(kid.id))}</div>
      <div class="balances">
        ${categories.map((category) => `<div class="balance"><span>${escapeHtml(category)}</span><strong>${money(balance(kid.id, category))}</strong></div>`).join("")}
      </div>
    </article>`).join("");
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
        ${categories.map((category) => `<div class="detail-balance"><span>${escapeHtml(category)}</span><strong>${money(balance(kid.id, category))}</strong></div>`).join("")}
      </div>
    </div>
    <div class="quick-actions">
      <button class="quick-action primary" type="button" data-action="pay"><span>Record job pay<small>Split into five equal shares</small></span><span class="quick-action-icon">＋</span></button>
      <button class="quick-action secondary" type="button" data-action="adjust"><span>Spend or adjust<small>Update one money bucket</small></span><span class="quick-action-icon">↗</span></button>
    </div>
    <div class="history-card">
      <div class="history-head"><div><h2>Activity</h2><p>${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}</p></div><button class="secondary" type="button" data-action="backup">Backup</button></div>
      <div>
        ${transactions.length ? transactions.map((transaction) => `
          <div class="transaction">
            <div class="tx-icon" aria-hidden="true">${categoryIcons[transaction.category] || "•"}</div>
            <div class="tx-copy"><strong>${escapeHtml(transaction.note || transaction.category)}</strong><small>${escapeHtml(transaction.category)} · ${new Date(transaction.time).toLocaleString()}</small></div>
            <div class="tx-amount ${transaction.amount >= 0 ? "plus" : "minus"}">${transaction.amount >= 0 ? "+" : "−"}${money(Math.abs(transaction.amount))}</div>
          </div>`).join("") : `<div class="empty-history">No activity yet. Record a job payment to get started.</div>`}
      </div>
    </div>`;
}

function openKid(id) {
  selectedKidId = id;
  homeView.classList.add("hidden");
  detailView.classList.remove("hidden");
  renderDetail();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
  selectedKidId = null;
  detailView.classList.add("hidden");
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
  openModal(`${closeButton()}<h2 id="modalTitle">Record job pay</h2><p class="modal-copy">The full amount is divided into five equal shares. Pocket, Short Term, and Long Term are tracked here.</p><form id="payForm"><label for="payAmount">Total pay</label><input id="payAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="25.00" required><div id="splitPreview" class="split-preview" hidden></div><label for="payNote">What was the job? <span style="font-weight:400">(optional)</span></label><input id="payNote" name="note" maxlength="80" placeholder="Mowed the lawn"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Divide & pay</button></div></form>`);
}

function updateSplitPreview(input) {
  const cents = Math.round(Number(input.value) * 100);
  const preview = document.getElementById("splitPreview");
  if (!cents || cents < 1) return preview.hidden = true;
  const shares = splitCents(cents);
  preview.hidden = false;
  preview.innerHTML = categories.map((category, index) => `<div><span>${escapeHtml(category)}</span><strong>${money(shares[index] / 100)}</strong></div>`).join("");
}

function splitCents(totalCents) {
  const base = Math.floor(totalCents / 5);
  const shares = [base, base, base, base, base];
  for (let index = 0; index < totalCents - base * 5; index += 1) shares[index] += 1;
  return shares;
}

function openAdjust() {
  openModal(`${closeButton()}<h2 id="modalTitle">Spend or adjust</h2><p class="modal-copy">Choose one bucket to update.</p><form id="adjustForm"><label for="adjustCategory">Money bucket</label><select id="adjustCategory" name="category">${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}</select><label for="adjustAmount">Amount</label><input id="adjustAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="5.00" required><label for="adjustType">Type</label><select id="adjustType" name="type"><option value="-1">Spend / subtract</option><option value="1">Add money</option></select><label for="adjustNote">Note <span style="font-weight:400">(optional)</span></label><input id="adjustNote" name="note" maxlength="80" placeholder="Bought a book"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save transaction</button></div></form>`);
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
    const restored = JSON.parse(await file.text());
    if (!Array.isArray(restored.kids) || !Array.isArray(restored.transactions)) throw new Error("Invalid backup");
    const validCategories = new Set(categories);
    if (restored.kids.some((kid) => !kid.id || typeof kid.name !== "string") || restored.transactions.some((tx) => !tx.id || !tx.kidId || !validCategories.has(tx.category) || !Number.isFinite(Number(tx.amount)) || !Number.isFinite(Number(tx.time)))) throw new Error("Invalid backup");
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
  const kidCard = event.target.closest("[data-kid-id]");
  if (kidCard) return openKid(kidCard.dataset.kidId);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const actions = {
    "add-kid": openAddKid,
    close: closeModal,
    rename: openRename,
    pay: openPay,
    adjust: openAdjust,
    backup: openBackup,
    download: exportData,
    restore: () => restoreInput.click(),
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

document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-kid-id]")) {
    event.preventDefault();
    openKid(event.target.dataset.kidId);
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
    const note = values.get("note").trim() || `Job pay (${money(totalCents / 100)} total)`;
    categories.forEach((category, index) => state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category, amount: shares[index] / 100, note, time: Date.now() + index }));
    closeModal();
    persist("Job pay divided and added");
  }
  if (form.id === "adjustForm") {
    const amount = Math.round(Number(values.get("amount")) * 100) / 100;
    if (amount < .01) return;
    state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category: values.get("category"), amount: amount * Number(values.get("type")), note: values.get("note").trim(), time: Date.now() });
    closeModal();
    persist("Transaction saved");
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
document.getElementById("backupButton").addEventListener("click", openBackup);
document.getElementById("footerBackupButton").addEventListener("click", openBackup);
document.getElementById("backButton").addEventListener("click", showHome);

render();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
