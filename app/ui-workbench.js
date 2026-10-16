// 作業台 (仮)。中身 (方向性の案 → ページ → 保存) は PBI-015 が作る。
// ここでは #workbench に「準備中」を出し、見本帳からの studio:start-from-style を受けたら
// 作業台のタブに切り替えるだけにする
const section = document.getElementById("workbench");

if (section !== null) {
  section.replaceChildren();
  const title = document.createElement("h2");
  title.className = "screen-title";
  title.textContent = "作業台";
  const lead = document.createElement("p");
  lead.className = "screen-lead";
  lead.textContent = "準備中です。ここでは、曖昧な一言から方向性の案を出して、ページを作って保存できるようになります。";
  section.append(title, lead);
}

// 見本帳の「これに近いもので作る」で切り替える (タブは殻の data-tab ボタン)
window.addEventListener("studio:start-from-style", () => {
  const tab = document.querySelector('button[data-tab="workbench"]');
  if (tab !== null) tab.click();
});
