import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { familyDocumentPath, firebaseConfig } from "./firebase-config.js";
import { demoState } from "./demo-data.js";

const STORAGE_KEY = "familyMoneyTracker.v3";
const ACCESS_CACHE_KEY = "familyMoneyTracker.access.v1";
const PREVIOUS_KEYS = ["familyMoneyTracker.v2", "familyMoneyTracker.v1"];
const categories = ["Short Term", "Long Term", "Very Long Term"];
const activeCategories = ["Short Term", "Long Term"];
const categoryIcons = { "Short Term": "ST", "Long Term": "LT", "Very Long Term": "VLT" };
const accents = ["#dff4e8", "#ddecff", "#ffe4dc", "#fff0bd", "#eadffc", "#d9f1ef"];
const graphemeSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const leadingEmojiPattern = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u;
const DEMO_MODE = new URLSearchParams(window.location.search).get("demo") === "1";

let state = DEMO_MODE ? structuredClone(demoState) : loadState();
let selectedKidId = null;
let selectedTransactionId = null;
let toastTimer;
let dragState = null;
let accessMode = "loading";
let currentUser = null;
let familySettings = { memberEmails: [] };
let cloudReady = false;
let unsubscribeFamily = null;
let syncChain = Promise.resolve();

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const familyRef = doc(db, familyDocumentPath);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const homeView = document.getElementById("homeView");
const detailView = document.getElementById("detailView");
const balanceView = document.getElementById("balanceView");
const kidsGrid = document.getElementById("kidsGrid");
const balanceEditorList = document.getElementById("balanceEditorList");
const balanceSaveBar = document.getElementById("balanceSaveBar");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");
const restoreInput = document.getElementById("restoreInput");
const authView = document.getElementById("authView");
const authMessage = document.getElementById("authMessage");
const syncStatus = document.getElementById("syncStatus");
const footerStatus = document.getElementById("footerStatus");
const accountButton = document.getElementById("accountButton");

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

function saveLocalState() {
  state.schemaVersion = 3;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveCachedAccess(user, mode) {
  if (!user?.uid || !["owner", "viewer"].includes(mode)) return;
  localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ uid: user.uid, mode, savedAt: Date.now() }));
}

function cachedAccessForUser(user) {
  try {
    const cached = JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY));
    if (cached?.uid !== user?.uid || !["owner", "viewer"].includes(cached.mode)) return null;
    return cached.mode;
  } catch {
    return null;
  }
}

function isOfflineError(error) {
  return !navigator.onLine || ["unavailable", "deadline-exceeded", "auth/network-request-failed"].includes(error?.code);
}

function persist(message) {
  if (DEMO_MODE) {
    state.schemaVersion = 3;
    render();
    if (message) showToast(`${message} — demo only`);
    return;
  }
  if (["viewer", "offline"].includes(accessMode)) return showToast("Reconnect to make changes");
  saveLocalState();
  render();
  if (message) showToast(message);
  if (cloudReady && accessMode === "owner") queueCloudSave();
}

function queueCloudSave() {
  setSyncState("saving", "Saving…");
  const payload = {
    schemaVersion: 3,
    kids: structuredClone(state.kids),
    transactions: structuredClone(state.transactions),
    updatedAt: serverTimestamp()
  };
  syncChain = syncChain
    .then(() => setDoc(familyRef, payload, { merge: true }))
    .then(() => setSyncState("synced", "Synced"))
    .catch((error) => {
      console.error("Cloud save failed", error);
      setSyncState("offline", "Saved offline");
      showToast("Saved on this device; cloud sync will retry");
    });
}

function setSyncState(kind, label) {
  syncStatus.dataset.state = kind;
  syncStatus.querySelector(".sync-label").textContent = label;
  footerStatus.textContent = kind === "synced"
    ? "Synced securely with your family"
    : kind === "offline"
      ? "Showing the latest balances saved on this device"
      : kind === "viewer"
        ? "Viewing your family’s synced balances"
        : kind === "saving"
          ? "Saving changes to your family"
          : "Sign in to sync family data";
}

function applyAccessMode(mode, message = "") {
  accessMode = mode;
  document.body.dataset.access = mode;
  const authenticated = ["owner", "viewer", "offline"].includes(mode);
  authView.classList.toggle("hidden", authenticated);
  homeView.classList.toggle("hidden", !authenticated);
  detailView.classList.add("hidden");
  balanceView.classList.add("hidden");
  if (message) authMessage.textContent = message;
  if (mode === "owner") setSyncState("synced", "Synced");
  else if (mode === "viewer") setSyncState("viewer", "View only");
  else if (mode === "offline") setSyncState("offline", "Offline copy");
  else if (mode === "loading") setSyncState("saving", "Connecting…");
  else setSyncState("signed-out", "Sign in");
  accountButton.hidden = !currentUser;
  render();
}

function cloudStateFromDocument(data) {
  return {
    schemaVersion: 3,
    kids: Array.isArray(data.kids) ? data.kids : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : []
  };
}

function watchFamily() {
  unsubscribeFamily?.();
  unsubscribeFamily = onSnapshot(familyRef, { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const resolvedAccessMode = data.ownerUid === currentUser?.uid ? "owner" : "viewer";
    saveCachedAccess(currentUser, resolvedAccessMode);
    familySettings = { memberEmails: Array.isArray(data.memberEmails) ? data.memberEmails : [] };
    const cloudState = cloudStateFromDocument(data);
    if (data.ownerUid === currentUser?.uid && cloudState.kids.length === 0 && cloudState.transactions.length === 0 && hasLocalFamilyData()) {
      cloudReady = true;
      applyAccessMode("owner");
      openFirstCloudSetup();
      return;
    }
    state = cloudState;
    saveLocalState();
    cloudReady = true;
    if (accessMode === "offline") applyAccessMode(resolvedAccessMode);
    else {
      accessMode = resolvedAccessMode;
      document.body.dataset.access = resolvedAccessMode;
      render();
    }
    setSyncState(snapshot.metadata.hasPendingWrites ? "saving" : resolvedAccessMode === "viewer" ? "viewer" : "synced", snapshot.metadata.hasPendingWrites ? "Saving…" : resolvedAccessMode === "viewer" ? "View only" : "Synced");
  }, (error) => {
    console.error("Family sync failed", error);
    cloudReady = false;
    setSyncState("offline", "Offline");
  });
}

function hasLocalFamilyData() {
  return state.kids.length > 0 || state.transactions.length > 0;
}

function openFirstCloudSetup() {
  openModal(`${closeButton()}<h2 id="modalTitle">Move this tracker to Firebase?</h2><p class="modal-copy">This will upload the kids, balances, and activity currently saved on this device to your private family database. Approved family Google accounts will be able to view the totals.</p><div class="modal-actions"><button class="secondary" type="button" data-action="sign-out">Not now</button><button class="primary" type="button" data-action="confirm-cloud-setup">Move data & sync</button></div>`);
}

async function createFamilyCloud() {
  if (!currentUser) return;
  const payload = {
    ownerUid: currentUser.uid,
    ownerEmail: currentUser.email || "",
    memberEmails: [],
    schemaVersion: 3,
    kids: structuredClone(state.kids),
    transactions: structuredClone(state.transactions),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(familyRef, payload);
    closeModal();
    cloudReady = true;
    saveCachedAccess(currentUser, "owner");
    applyAccessMode("owner");
    watchFamily();
    showToast(hasLocalFamilyData() ? "Family data moved to Firebase" : "Family tracker created");
  } catch (error) {
    console.error("Family setup failed", error);
    showToast("This Google account cannot create the family tracker");
  }
}

async function connectSignedInUser(user) {
  currentUser = user;
  accountButton.hidden = false;
  accountButton.innerHTML = user.photoURL
    ? `<img src="${attr(user.photoURL)}" alt="">`
    : `<span>${escapeHtml(initials(user.displayName || user.email || "Google"))}</span>`;
  if (!navigator.onLine && cachedAccessForUser(user)) {
    cloudReady = false;
    applyAccessMode("offline");
    watchFamily();
    return;
  }
  applyAccessMode("loading", "Checking your family access…");
  try {
    const snapshot = await getDoc(familyRef);
    if (!snapshot.exists()) {
      accessMode = "setup";
      document.body.dataset.access = "setup";
      setSyncState("saving", "Setup needed");
      openFirstCloudSetup();
      return;
    }
    const data = snapshot.data();
    familySettings = { memberEmails: Array.isArray(data.memberEmails) ? data.memberEmails : [] };
    state = cloudStateFromDocument(data);
    saveLocalState();
    cloudReady = true;
    const resolvedAccessMode = data.ownerUid === user.uid ? "owner" : "viewer";
    saveCachedAccess(user, resolvedAccessMode);
    applyAccessMode(resolvedAccessMode);
    watchFamily();
  } catch (error) {
    console.error("Access check failed", error);
    cloudReady = false;
    if (isOfflineError(error) && cachedAccessForUser(user)) {
      applyAccessMode("offline");
      watchFamily();
      return;
    }
    applyAccessMode("unapproved", "This Google account has not been approved yet. Ask the family owner to add its email address in Family access.");
  }
}

async function startGoogleSignIn() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    if (error.code !== "auth/popup-closed-by-user") showToast("Google sign-in didn’t finish");
  }
}

async function signOutUser() {
  closeModal();
  unsubscribeFamily?.();
  unsubscribeFamily = null;
  cloudReady = false;
  await signOut(auth);
}

function openAccount() {
  if (!currentUser) return startGoogleSignIn();
  const ownerControls = accessMode === "owner" ? `<button class="backup-option" type="button" data-action="family-access"><span>👥</span><span><strong>Family access</strong><small>Approve Google accounts for view-only access</small></span></button>` : "";
  const roleLabel = accessMode === "owner" ? "Family owner" : accessMode === "offline" ? "Offline copy" : "View only";
  openModal(`${closeButton()}<h2 id="modalTitle">${escapeHtml(currentUser.displayName || "Google account")}</h2><p class="modal-copy">${escapeHtml(currentUser.email || "")} · ${roleLabel}</p><div class="backup-options">${ownerControls}<button class="backup-option" type="button" data-action="sign-out"><span>↪</span><span><strong>Sign out</strong><small>Leave this family tracker on this device</small></span></button></div>`);
}

function openFamilyAccess() {
  const emails = familySettings.memberEmails;
  openModal(`${closeButton()}<h2 id="modalTitle">Family access</h2><p class="modal-copy">Approved Google accounts can see every child’s totals and activity, but cannot make changes.</p><form id="familyAccessForm"><label for="memberEmail">Google account email</label><div class="inline-form"><input id="memberEmail" name="email" type="email" autocomplete="email" placeholder="kid@example.com" required><button class="primary" type="submit">Add</button></div></form><div class="member-list">${emails.length ? emails.map((email) => `<div><span>${escapeHtml(email)}</span><button class="tx-action delete" type="button" data-action="remove-member" data-member-email="${attr(email)}" aria-label="Remove ${attr(email)}">Remove</button></div>`).join("") : `<p>No viewing accounts added yet.</p>`}</div>`);
}

async function updateMemberEmails(emails, successMessage) {
  try {
    await updateDoc(familyRef, { memberEmails: [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))], updatedAt: serverTimestamp() });
    familySettings.memberEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    openFamilyAccess();
    showToast(successMessage);
  } catch (error) {
    console.error("Family access update failed", error);
    showToast("Family access could not be updated");
  }
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

function kidPresentation(name) {
  const fullName = String(name).trim();
  const firstGrapheme = graphemeSegmenter
    ? graphemeSegmenter.segment(fullName)[Symbol.iterator]().next().value?.segment || ""
    : Array.from(fullName)[0] || "";
  const usesEmojiAvatar = leadingEmojiPattern.test(firstGrapheme);
  return {
    avatar: usesEmojiAvatar ? firstGrapheme : initials(fullName),
    name: usesEmojiAvatar ? fullName.slice(firstGrapheme.length).trimStart() || "Child" : fullName,
    usesEmojiAvatar
  };
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
          <p>Add a child, see their everyday money, and add weekly pay to all three savings categories.</p>
          <button class="primary owner-only" type="button" data-action="add-kid" style="margin-top:18px">Add your first child</button>
        </div>
        <div class="empty-icon" aria-hidden="true">✦</div>
      </div>`;
    return;
  }

  kidsGrid.innerHTML = state.kids.map((kid, index) => {
    const display = kidPresentation(kid.name);
    return `
    <article class="kid-card" data-kid-id="${attr(kid.id)}" style="--card-accent:${accents[index % accents.length]}">
      <button class="kid-card-open" type="button" data-open-kid="${attr(kid.id)}" aria-label="View ${attr(display.name)} details and Very Long Term savings">
        <div class="kid-top">
          <div class="kid-identity">
            <div class="avatar${display.usesEmojiAvatar ? " emoji-avatar" : ""}">${escapeHtml(display.avatar)}</div>
            <div><h3 class="kid-name">${escapeHtml(display.name)}</h3><span>View savings details</span></div>
          </div>
          <span class="arrow" aria-hidden="true">→</span>
        </div>
        <div class="balances">
          ${activeCategories.map((category) => `<div class="balance"><span>${escapeHtml(category)}</span><strong>${money(balance(kid.id, category))}</strong></div>`).join("")}
        </div>
      </button>
      <div class="card-actions owner-only">
        <button class="card-action spend" type="button" data-action="quick-spend" data-target-kid="${attr(kid.id)}" aria-label="Record spending for ${attr(display.name)}">− Spend</button>
        <button class="card-action weekly" type="button" data-action="quick-pay" data-target-kid="${attr(kid.id)}" aria-label="Add weekly pay for ${attr(display.name)}">＋ Pay</button>
      </div>
      <button class="drag-handle owner-only" type="button" data-reorder-kid="${attr(kid.id)}" aria-label="Reorder ${attr(display.name)}. Drag, or use arrow keys to move." title="Drag to reorder"><span aria-hidden="true">⠿</span></button>
    </article>`;
  }).join("");
}

function renderBalanceEditor() {
  balanceSaveBar.hidden = state.kids.length === 0;
  if (!state.kids.length) {
    balanceEditorList.innerHTML = `<div class="empty-state"><div><h3>Add a child first</h3><p>Once a child exists, their Short Term, Long Term, and Very Long Term balances can be entered here.</p><button class="primary owner-only" type="button" data-action="add-kid" style="margin-top:18px">Add child</button></div><div class="empty-icon" aria-hidden="true">✦</div></div>`;
    return;
  }

  balanceEditorList.innerHTML = state.kids.map((kid, index) => {
    const display = kidPresentation(kid.name);
    return `
    <section class="balance-edit-row" data-balance-kid="${attr(kid.id)}" style="--card-accent:${accents[index % accents.length]}">
      <div class="balance-edit-kid"><div class="avatar${display.usesEmojiAvatar ? " emoji-avatar" : ""}">${escapeHtml(display.avatar)}</div><strong>${escapeHtml(display.name)}</strong></div>
      <div class="balance-edit-fields">
        ${categories.map((category) => `<label><span>${escapeHtml(category)}</span><input type="number" step="0.01" inputmode="decimal" value="${balance(kid.id, category).toFixed(2)}" data-balance-category="${attr(category)}" aria-label="${attr(display.name)} ${attr(category)} balance"${category === "Very Long Term" ? " min=\"0\"" : ""} required></label>`).join("")}
      </div>
    </section>`;
  }).join("");
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
  const display = kidPresentation(kid.name);
  const vltBalance = balance(kid.id, "Very Long Term");
  const transactions = state.transactions
    .filter((transaction) => transaction.kidId === kid.id)
    .sort((a, b) => b.time - a.time);

  document.getElementById("kidDetail").innerHTML = `
    <div class="detail-hero">
      <div class="detail-title-row">
        <div class="avatar${display.usesEmojiAvatar ? " emoji-avatar" : ""}">${escapeHtml(display.avatar)}</div>
        <div><p class="eyebrow">Money dashboard</p><h1 id="detailName">${escapeHtml(display.name)}</h1></div>
      </div>
      <div class="detail-actions owner-only">
        <button class="secondary" type="button" data-action="rename">Rename</button>
        <button class="danger" type="button" data-action="delete-kid">Delete</button>
      </div>
      <div class="detail-balances">
        ${activeCategories.map((category) => `<div class="detail-balance"><span>${escapeHtml(category)}</span><strong>${money(balance(kid.id, category))}</strong></div>`).join("")}
      </div>
    </div>
    <div class="quick-actions owner-only">
      <button class="quick-action primary" type="button" data-action="adjust"><span>Record spending<small>Short Term or Long Term</small></span><span class="quick-action-icon">−</span></button>
      <button class="quick-action secondary" type="button" data-action="pay"><span>Add weekly pay<small>Same amount in all three categories</small></span><span class="quick-action-icon">＋</span></button>
    </div>
    <section class="vault-card" aria-labelledby="vaultTitle">
      <div class="vault-icon" aria-hidden="true">⌁</div>
      <div class="vault-copy"><p class="eyebrow">Quiet savings</p><h2 id="vaultTitle">Very Long Term</h2><p>Amount still held in your checking account for their future.</p></div>
      <div class="vault-actions"><strong>${money(vltBalance)}</strong><button class="secondary owner-only" type="button" data-action="transfer-vlt"${vltBalance <= 0 ? " disabled" : ""}>Mark transferred</button></div>
    </section>
    <div class="history-card">
      <div class="history-head"><div><h2>Activity</h2><p>${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}</p></div><button class="secondary owner-only" type="button" data-action="backup">Backup</button></div>
      <div>
        ${transactions.length ? transactions.map((transaction) => `
          <div class="transaction" data-transaction-id="${attr(transaction.id)}">
            <div class="tx-icon" aria-hidden="true">${categoryIcons[transaction.category] || "—"}</div>
            <div class="tx-copy"><strong>${escapeHtml(transaction.note || transaction.category)}</strong><small>${escapeHtml(transaction.category)} · ${new Date(transaction.time).toLocaleString()}</small></div>
            <div class="tx-amount ${transaction.amount >= 0 ? "plus" : "minus"}">${transaction.amount >= 0 ? "+" : "−"}${money(Math.abs(transaction.amount))}</div>
            <div class="tx-actions owner-only"><button class="tx-action" type="button" data-action="edit-transaction" data-transaction-id="${attr(transaction.id)}" aria-label="Edit ${attr(transaction.note || transaction.category)}"><span aria-hidden="true">✎</span><span class="tx-action-label">Edit</span></button><button class="tx-action delete" type="button" data-action="delete-transaction" data-transaction-id="${attr(transaction.id)}" aria-label="Delete ${attr(transaction.note || transaction.category)}"><span aria-hidden="true">×</span><span class="tx-action-label">Delete</span></button></div>
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
  openModal(`${closeButton()}<h2 id="modalTitle">Add weekly pay</h2><p class="modal-copy">Enter the amount to add to each tracked category. Pocket and Tithe stay untracked.</p><form id="payForm"><label for="payAmount">Amount per category</label><input id="payAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="5.00" required><div id="splitPreview" class="split-preview" hidden></div><label for="payNote">Note <span style="font-weight:400">(optional)</span></label><input id="payNote" name="note" maxlength="80" placeholder="Weekly jobs"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Add to all three</button></div></form>`);
}

function updateSplitPreview(input) {
  const cents = Math.round(Number(input.value) * 100);
  const preview = document.getElementById("splitPreview");
  if (!cents || cents < 1) return preview.hidden = true;
  preview.hidden = false;
  preview.innerHTML = categories.map((category) => `<div><span>${escapeHtml(category)}</span><strong>${money(cents / 100)}</strong></div>`).join("");
}

function openAdjust() {
  openModal(`${closeButton()}<h2 id="modalTitle">Record spending</h2><p class="modal-copy">Update Short Term or Long Term money.</p><form id="adjustForm"><fieldset class="choice-field"><legend>Money bucket</legend><div class="segmented">${activeCategories.map((category, index) => `<label><input type="radio" name="category" value="${escapeHtml(category)}"${index === 0 ? " checked" : ""}><span>${escapeHtml(category)}</span></label>`).join("")}</div></fieldset><label for="adjustAmount">Amount</label><input id="adjustAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="5.00" required><fieldset class="choice-field"><legend>Type</legend><div class="segmented"><label><input type="radio" name="type" value="-1" checked><span>Spend</span></label><label><input type="radio" name="type" value="1"><span>Add money</span></label></div></fieldset><label for="adjustNote">Note <span style="font-weight:400">(optional)</span></label><input id="adjustNote" name="note" maxlength="80" placeholder="Bought a book"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save transaction</button></div></form>`);
}

function openBackup() {
  openModal(`${closeButton()}<h2 id="modalTitle">Backup and restore</h2><p class="modal-copy">Firebase keeps the family in sync. A downloaded JSON backup gives you an extra copy you control.</p><div class="backup-options"><button class="backup-option" type="button" data-action="download"><span>↓</span><span><strong>Download backup</strong><small>Save all kids, balances, and activity</small></span></button><button class="backup-option" type="button" data-action="restore"><span>↑</span><span><strong>Restore a backup</strong><small>Replace the synced family data from a JSON file</small></span></button></div>`);
}

function deleteKid() {
  const kid = state.kids.find((item) => item.id === selectedKidId);
  openModal(`${closeButton()}<h2 id="modalTitle">Delete ${escapeHtml(kid.name)}?</h2><p class="modal-copy">This permanently removes their balances and transaction history from the synced family tracker. Download a backup first if you may need it later.</p><div class="modal-actions"><button class="secondary" type="button" data-action="close">Keep child</button><button class="danger" type="button" data-action="confirm-delete">Delete everything</button></div>`);
}

function openVltTransfer() {
  const kid = state.kids.find((item) => item.id === selectedKidId);
  const amount = kid ? balance(kid.id, "Very Long Term") : 0;
  if (!kid || amount <= 0) return showToast("There is no VLT balance to transfer");
  openModal(`${closeButton()}<h2 id="modalTitle">Mark ${money(amount)} transferred?</h2><p class="modal-copy">Use this after moving the money from your checking account into ${escapeHtml(kid.name)}’s savings account. Their VLT balance here will become $0, and the transfer will remain in Activity.</p><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="button" data-action="confirm-vlt-transfer">Set VLT to $0</button></div>`);
}

function openEditTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id && item.kidId === selectedKidId);
  if (!transaction) return showToast("That activity entry is no longer available");
  selectedTransactionId = id;
  openModal(`${closeButton()}<h2 id="modalTitle">Edit activity</h2><p class="modal-copy">The original date and time will stay the same.</p><form id="editTransactionForm"><fieldset class="choice-field"><legend>Money bucket</legend><div class="segmented three">${categories.map((category) => `<label><input type="radio" name="category" value="${escapeHtml(category)}"${transaction.category === category ? " checked" : ""}><span>${escapeHtml(category)}</span></label>`).join("")}</div></fieldset><label for="editTransactionAmount">Amount</label><input id="editTransactionAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${Math.abs(Number(transaction.amount)).toFixed(2)}" required><fieldset class="choice-field"><legend>Type</legend><div class="segmented"><label><input type="radio" name="type" value="-1"${transaction.amount < 0 ? " checked" : ""}><span>Subtract</span></label><label><input type="radio" name="type" value="1"${transaction.amount >= 0 ? " checked" : ""}><span>Add money</span></label></div></fieldset><label for="editTransactionNote">Note <span style="font-weight:400">(optional)</span></label><input id="editTransactionNote" name="note" maxlength="80" value="${attr(transaction.note || "")}" placeholder="What was this for?"><div class="modal-actions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save changes</button></div></form>`);
}

function openDeleteTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id && item.kidId === selectedKidId);
  if (!transaction) return showToast("That activity entry is no longer available");
  selectedTransactionId = id;
  const signedAmount = `${transaction.amount >= 0 ? "+" : "−"}${money(Math.abs(transaction.amount))}`;
  openModal(`${closeButton()}<h2 id="modalTitle">Delete this activity?</h2><p class="modal-copy"><strong>${escapeHtml(transaction.note || transaction.category)}</strong><br>${escapeHtml(transaction.category)} · ${signedAmount}<br><br>This will recalculate the child’s balances and cannot be undone.</p><div class="modal-actions"><button class="secondary" type="button" data-action="close">Keep entry</button><button class="danger" type="button" data-action="confirm-delete-transaction">Delete entry</button></div>`);
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
    if (restored.kids.some((kid) => !kid.id || typeof kid.name !== "string") || restored.transactions.some((tx) => !tx.id || !tx.kidId || !validCategories.has(tx.category) || !Number.isFinite(Number(tx.amount)) || !Number.isFinite(Number(tx.time)) || (tx.category === "Very Long Term" && Number(tx.amount) < 0 && !["balance-set", "vlt-transfer"].includes(tx.kind)))) throw new Error("Invalid backup");
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
  const ownerActions = new Set(["add-kid", "rename", "pay", "adjust", "quick-spend", "quick-pay", "backup", "download", "restore", "balance-cancel", "transfer-vlt", "edit-transaction", "delete-transaction", "confirm-delete-transaction", "confirm-vlt-transfer", "delete-kid", "confirm-delete", "family-access", "remove-member"]);
  if (ownerActions.has(action) && accessMode !== "owner") return showToast("This account has view-only access");
  const actions = {
    "add-kid": openAddKid,
    close: closeModal,
    rename: openRename,
    pay: openPay,
    adjust: openAdjust,
    "quick-spend": () => { selectedKidId = actionTarget.dataset.targetKid; openAdjust(); },
    "quick-pay": () => { selectedKidId = actionTarget.dataset.targetKid; openPay(); },
    backup: openBackup,
    "family-access": openFamilyAccess,
    "remove-member": () => updateMemberEmails(familySettings.memberEmails.filter((email) => email !== actionTarget.dataset.memberEmail), "Viewing account removed"),
    "sign-out": signOutUser,
    "confirm-cloud-setup": createFamilyCloud,
    download: exportData,
    restore: () => restoreInput.click(),
    "balance-cancel": showHome,
    "transfer-vlt": openVltTransfer,
    "edit-transaction": () => openEditTransaction(actionTarget.dataset.transactionId),
    "delete-transaction": () => openDeleteTransaction(actionTarget.dataset.transactionId),
    "confirm-delete-transaction": () => {
      const beforeCount = state.transactions.length;
      state.transactions = state.transactions.filter((transaction) => transaction.id !== selectedTransactionId || transaction.kidId !== selectedKidId);
      selectedTransactionId = null;
      closeModal();
      if (state.transactions.length < beforeCount) persist("Activity entry deleted");
    },
    "confirm-vlt-transfer": () => {
      const amount = balance(selectedKidId, "Very Long Term");
      if (amount <= 0) return closeModal();
      state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category: "Very Long Term", amount: -amount, kind: "vlt-transfer", note: "Moved to savings account", time: Date.now() });
      closeModal();
      persist("VLT transfer recorded");
    },
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
    const amountCents = Math.round(Number(values.get("amount")) * 100);
    if (amountCents < 1) return;
    const amount = amountCents / 100;
    const note = values.get("note").trim() || `Weekly pay (${money(amount)} per category)`;
    categories.forEach((category, index) => state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category, amount, note, time: Date.now() + index }));
    closeModal();
    persist("Weekly pay added to all three categories");
  }
  if (form.id === "adjustForm") {
    const amount = Math.round(Number(values.get("amount")) * 100) / 100;
    if (amount < .01) return;
    state.transactions.push({ id: uniqueId(), kidId: selectedKidId, category: values.get("category"), amount: amount * Number(values.get("type")), note: values.get("note").trim(), time: Date.now() });
    closeModal();
    persist("Transaction saved");
  }
  if (form.id === "editTransactionForm") {
    const transaction = state.transactions.find((item) => item.id === selectedTransactionId && item.kidId === selectedKidId);
    if (!transaction) {
      closeModal();
      return showToast("That activity entry is no longer available");
    }
    const amount = Math.round(Number(values.get("amount")) * 100) / 100;
    if (amount < .01) return;
    const category = values.get("category");
    const signedAmount = amount * Number(values.get("type"));
    transaction.category = category;
    transaction.amount = signedAmount;
    transaction.note = values.get("note").trim();
    if (transaction.kind === "vlt-transfer" && (category !== "Very Long Term" || signedAmount >= 0)) delete transaction.kind;
    if (transaction.kind === "balance-set" && !(category === "Very Long Term" && signedAmount < 0)) delete transaction.kind;
    if (category === "Very Long Term" && signedAmount < 0 && !["balance-set", "vlt-transfer"].includes(transaction.kind)) transaction.kind = "balance-set";
    selectedTransactionId = null;
    closeModal();
    persist("Activity entry updated");
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
  if (form.id === "familyAccessForm") {
    if (accessMode !== "owner") return showToast("Only the family owner can change access");
    const email = String(values.get("email") || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return showToast("Enter a valid Google account email");
    updateMemberEmails([...familySettings.memberEmails, email], "Viewing account added");
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
document.getElementById("signInButton").addEventListener("click", startGoogleSignIn);
accountButton.addEventListener("click", openAccount);

if (DEMO_MODE) {
  currentUser = null;
  accountButton.hidden = true;
  cloudReady = false;
  document.title = "Family Money Tracker — Demo";
  document.body.dataset.demo = "true";
  applyAccessMode("owner");
  accountButton.hidden = true;
  syncStatus.dataset.state = "viewer";
  syncStatus.querySelector(".sync-label").textContent = "Demo";
  footerStatus.textContent = "Demo edits reset on refresh — your real family tracker is unchanged";
} else {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  getRedirectResult(auth).catch((error) => {
    console.error("Redirect sign-in failed", error);
    showToast("Google sign-in didn’t finish");
  });
  onAuthStateChanged(auth, (user) => {
    if (user) return connectSignedInUser(user);
    currentUser = null;
    accountButton.hidden = true;
    cloudReady = false;
    applyAccessMode("signedOut", "Sign in with Google to open your family’s money tracker.");
  });
  applyAccessMode("loading", "Connecting to your family tracker…");
}
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
