/* Online Exam – Admin Console (Vanilla JS)
 * Local-only publishing for MVP. For production, replace localStorage with server DB.
 */
const LS_KEYS = {
  PUBLISHED: "exam.published",
  SETTINGS: "exam.settings",
  SUBMITS: "exam.submits",
};

const el = s => document.querySelector(s);
const examJson = el("#examJson");
const fileInput = el("#fileInput");
const btnLoadSample = el("#btnLoadSample");
const btnPublish = el("#btnPublish");
const btnClear = el("#btnClear");
const btnExport = el("#btnExport");
const btnDumpSubmits = el("#btnDumpSubmits");
const btnExportCSV = el("#btnExportCSV");

function writeLS(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function readLS(k,d=null){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d;}catch{return d;} }

btnLoadSample.addEventListener("click", async ()=>{
  const res = await fetch("questions.sample.json").then(r=>r.json()).catch(()=>null);
  if(!res){ alert("샘플을 불러올 수 없습니다."); return; }
  examJson.value = JSON.stringify(res, null, 2);
});

fileInput.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const txt = await f.text();
  examJson.value = txt;
});

btnPublish.addEventListener("click", ()=>{
  let payload;
  try{ payload = JSON.parse(examJson.value); }catch{
    alert("유효한 JSON이 아닙니다."); return;
  }
  const accessCode = document.getElementById("accessCode").value.trim() || "MID2025";
  const maxViolations = Number(document.getElementById("maxViolations").value || 3);
  const voiceHint = document.getElementById("voiceHint").value.trim();

  writeLS(LS_KEYS.PUBLISHED, payload);
  writeLS(LS_KEYS.SETTINGS, {accessCode, maxViolations, voiceHint});
  alert(`게시 완료. 접속 코드: ${accessCode}`);
});

btnClear.addEventListener("click", ()=>{
  if(!confirm("로컬 저장 데이터를 모두 삭제합니다. 계속할까요?")) return;
  localStorage.removeItem(LS_KEYS.PUBLISHED);
  localStorage.removeItem(LS_KEYS.SETTINGS);
  // 제출 데이터는 남겨 응시 기록 보존
  alert("게시 데이터 초기화 완료");
});

btnExport.addEventListener("click", ()=>{
  const cfg = readLS(LS_KEYS.SETTINGS, {});
  const payload = readLS(LS_KEYS.PUBLISHED, {});
  const out = JSON.stringify({settings: cfg, exam: payload}, null, 2);
  const blob = new Blob([out], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "exam-config.json"; a.click();
  URL.revokeObjectURL(url);
});

btnDumpSubmits.addEventListener("click", ()=>{
  const arr = readLS(LS_KEYS.SUBMITS, []);
  el("#submitsJson").textContent = JSON.stringify(arr, null, 2);
});

btnExportCSV.addEventListener("click", ()=>{
  const arr = readLS(LS_KEYS.SUBMITS, []);
  if(!arr.length){ alert("제출 데이터가 없습니다."); return; }
  // Flatten to CSV
  const rows = [["examId","title","name","id","submittedAt","auto","violations","score","total"]];
  arr.forEach(s=>{
    rows.push([s.examId, s.title, s.user?.name??"", s.user?.id??"", s.submittedAt, s.auto, s.violations, s.grade?.got??"", s.grade?.total??""]);
  });
  const csv = rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="submissions.csv"; a.click();
  URL.revokeObjectURL(url);
});

if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
  });
}
