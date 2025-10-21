/* Online Exam – Student App (Vanilla JS, PWA-ready)
 * Features:
 * - Login with name/id/accessCode (matches admin-published exam in localStorage)
 * - Timer + autosave to localStorage
 * - MCQ + Short answer support; auto-grading for MCQ
 * - Integrity: fullscreen toggle, copy/paste/ctxmenu disabled, blur/visibility/tab switches logged
 * - Auto-submit on violations threshold
 * - PWA offline via sw.js
 */

const LS_KEYS = {
  PUBLISHED: "exam.published", // exam payload (JSON string)
  SETTINGS: "exam.settings",   // {accessCode, maxViolations, voiceHint}
  SUBMITS: "exam.submits",     // array of submissions in this browser
};

const el = sel => document.querySelector(sel);
const loginSection = el("#loginSection");
const examSection = el("#examSection");
const resultSection = el("#resultSection");
const loginMsg = el("#loginMsg");
const examTitle = el("#examTitle");
const examMeta  = el("#examMeta");
const questionList = el("#questionList");
const examForm = el("#examForm");
const timerEl = el("#timer");
const logList = el("#logList");
const btnFullscreen = el("#btnFullscreen");
const btnSave = el("#btnSave");
const btnSubmit = el("#btnSubmit");
const scoreBlock = el("#scoreBlock");
const resultJson = el("#resultJson");
const btnDownload = el("#btnDownload");

let examData = null;
let currentUser = null;
let deadline = null;
let timerId = null;
let violations = 0;
let maxViolations = 3;
let integrityLog = [];

function readLS(key, def=null){
  try{ const v = localStorage.getItem(key); return v? JSON.parse(v) : def; }catch{ return def; }
}
function writeLS(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}
function appendLog(msg){
  const t = new Date().toLocaleTimeString();
  integrityLog.push({t, msg});
  const li = document.createElement("li");
  li.textContent = `[${t}] ${msg}`;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}

function secToHMS(sec){
  const h = Math.floor(sec/3600).toString().padStart(2,"0");
  const m = Math.floor((sec%3600)/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${h}:${m}:${s}`;
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

function buildExamUI(payload){
  examTitle.textContent = payload.meta.title || "시험";
  examMeta.textContent = `${payload.meta.examId} · 제한시간 ${Math.round(payload.meta.durationSec/60)}분${payload.meta.shuffle? " · 문제섞기" : ""}`;
  questionList.innerHTML = "";
  const qs = payload.meta.shuffle? [...payload.questions] : payload.questions.slice();
  if(payload.meta.shuffle) shuffle(qs);

  qs.forEach((q,idx)=>{
    const wrap = document.createElement("div");
    wrap.className = "q";
    const title = document.createElement("h4");
    title.textContent = `${idx+1}. ${q.text} (${q.points??1}점)`;
    wrap.appendChild(title);

    if(q.type==="mcq"){
      const opts = document.createElement("div");
      opts.className="opts";
      (q.options||[]).forEach((opt,i)=>{
        const row = document.createElement("label");
        row.className="opt";
        const r = document.createElement("input");
        r.type="radio"; r.name=`q_${q.id}`; r.value=i;
        const span = document.createElement("span");
        span.textContent = opt;
        row.appendChild(r); row.appendChild(span);
        opts.appendChild(row);
      });
      wrap.appendChild(opts);
    }else if(q.type==="short"){
      const ta = document.createElement("textarea");
      ta.name = `q_${q.id}`;
      ta.rows = 3;
      ta.placeholder = "답안을 입력하세요.";
      wrap.appendChild(ta);
    }else{
      const p = document.createElement("p");
      p.textContent = "(알 수 없는 문항 유형)";
      wrap.appendChild(p);
    }
    questionList.appendChild(wrap);
  });
}

function loadExamForAccess(code){
  const settings = readLS(LS_KEYS.SETTINGS);
  if(!settings || settings.accessCode !== code) return null;
  maxViolations = Number(settings.maxViolations ?? 3);
  examData = readLS(LS_KEYS.PUBLISHED);
  return examData;
}

// Integrity controls
function enforceGuards(){
  // disable context menu / copy / paste
  window.addEventListener("contextmenu", e=>e.preventDefault());
  ["copy","cut","paste","dragstart","drop"].forEach(evt=>{
    document.addEventListener(evt, e=>{
      e.preventDefault();
      appendLog(`차단됨: ${evt}`);
    });
  });

  // visibility / blur detection
  document.addEventListener("visibilitychange", ()=>{
    if(document.visibilityState === "hidden"){
      violations++;
      appendLog(`탭 이탈 감지 (${violations}/${maxViolations})`);
      maybeVoice("탭을 이탈하면 안됩니다. 지속 시 자동 제출됩니다.");
      checkAutoSubmit();
    }
  });
  window.addEventListener("blur", ()=>{
    violations++;
    appendLog(`창 포커스 이탈 (${violations}/${maxViolations})`);
    checkAutoSubmit();
  });

  // back / reload warning
  window.addEventListener("beforeunload", (e)=>{
    e.preventDefault(); e.returnValue = "";
  });

  // fullscreen helper
  btnFullscreen.addEventListener("click", async ()=>{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen().catch(()=>{});
      appendLog("전체화면 진입");
    }else{
      await document.exitFullscreen().catch(()=>{});
      appendLog("전체화면 종료");
    }
  });
}

function maybeVoice(text){
  const settings = readLS(LS_KEYS.SETTINGS);
  if(!settings || !settings.voiceHint) return;
  try{
    const utt = new SpeechSynthesisUtterance(text || settings.voiceHint);
    speechSynthesis.speak(utt);
  }catch{}
}

function startTimer(sec){
  const end = Date.now() + sec*1000;
  deadline = end;
  function tick(){
    const remain = Math.max(0, Math.floor((deadline - Date.now())/1000));
    timerEl.textContent = secToHMS(remain);
    if(remain<=0){
      clearInterval(timerId);
      appendLog("시간 종료 – 자동 제출");
      submitExam(true);
    }
  }
  tick();
  timerId = setInterval(tick, 1000);
}

function saveDraft(){
  const key = `exam.draft.${currentUser.id}.${examData.meta.examId}`;
  const answers = collectAnswers();
  writeLS(key, {answers, ts: Date.now()});
  appendLog("임시저장 완료");
}

function restoreDraft(){
  const key = `exam.draft.${currentUser.id}.${examData.meta.examId}`;
  const draft = readLS(key);
  if(!draft) return;
  // restore
  examData.questions.forEach(q=>{
    const name = `q_${q.id}`;
    const v = draft.answers[name];
    if(v===undefined||v===null) return;
    const input = examForm.elements[name];
    if(!input) return;
    if(q.type==="mcq"){
      const radios = examForm.querySelectorAll(`input[name='${name}']`);
      if(radios[v]) radios[v].checked = true;
    }else{
      input.value = v;
    }
  });
  appendLog("임시저장 복원");
}

function collectAnswers(){
  const answers = {};
  examData.questions.forEach(q=>{
    const name = `q_${q.id}`;
    if(q.type==="mcq"){
      const radios = examForm.querySelectorAll(`input[name='${name}']`);
      let val = null;
      radios.forEach((r,i)=>{ if(r.checked) val = i; });
      answers[name] = val;
    }else if(q.type==="short"){
      const v = examForm.elements[name]?.value ?? "";
      answers[name] = v.trim();
    }
  });
  return answers;
}

function grade(answers){
  let total=0, got=0;
  const details = [];
  examData.questions.forEach(q=>{
    const pts = Number(q.points ?? 1);
    total += pts;
    const name = `q_${q.id}`;
    if(q.type==="mcq"){
      const correct = Number(q.answer);
      const chosen = answers[name];
      const ok = (chosen===correct);
      if(ok) got += pts;
      details.push({id:q.id,type:q.type,points:pts,correct,chosen,ok});
    }else{
      details.push({id:q.id,type:q.type,points:pts,answer:"(수기채점)",value:answers[name]});
    }
  });
  return {total, got, details};
}

function submitExam(auto=false){
  const answers = collectAnswers();
  const g = grade(answers);
  const payload = {
    examId: examData.meta.examId,
    title: examData.meta.title,
    user: currentUser,
    submittedAt: new Date().toISOString(),
    auto,
    violations,
    integrityLog,
    answers,
    grade: g
  };
  // persist to local submits
  const arr = readLS(LS_KEYS.SUBMITS, []);
  arr.push(payload);
  writeLS(LS_KEYS.SUBMITS, arr);

  // show result
  scoreBlock.innerHTML = `<b>총점:</b> ${g.got} / ${g.total}점`;
  resultJson.textContent = JSON.stringify(payload, null, 2);
  loginSection.classList.add("hidden");
  examSection.classList.add("hidden");
  resultSection.classList.remove("hidden");
  clearInterval(timerId);
}

function checkAutoSubmit(){
  if(violations>=maxViolations){
    appendLog("허용 이탈 횟수 초과 – 자동 제출");
    submitExam(true);
  }
}

// Autosave every 5s
setInterval(()=>{
  if(examSection.classList.contains("hidden")) return;
  saveDraft();
}, 5000);

// Event wiring
document.getElementById("loginForm").addEventListener("submit", (e)=>{
  e.preventDefault();
  const name = document.getElementById("studentName").value.trim();
  const id = document.getElementById("studentId").value.trim();
  const code = document.getElementById("accessCode").value.trim();

  const payload = loadExamForAccess(code);
  if(!payload){
    loginMsg.textContent = "유효하지 않은 접속 코드이거나 시험이 게시되지 않았습니다.";
    return;
  }
  currentUser = {name, id};
  examData = payload;

  buildExamUI(examData);
  enforceGuards();
  maybeVoice("시험을 시작합니다. 부정행위 감지 시 자동 제출됩니다.");
  startTimer(Number(examData.meta.durationSec||3600));
  loginSection.classList.add("hidden");
  examSection.classList.remove("hidden");
  restoreDraft();
});

btnSave.addEventListener("click", saveDraft);
examForm.addEventListener("submit", (e)=>{ e.preventDefault(); submitExam(false); });
btnDownload.addEventListener("click", ()=>{
  const blob = new Blob([resultJson.textContent], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "exam-result.json"; a.click();
  URL.revokeObjectURL(url);
});

// PWA SW register
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
  });
}
