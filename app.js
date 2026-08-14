(function () {
  "use strict";

  const BANK = Array.isArray(window.BAZI_QUESTION_BANK) ? window.BAZI_QUESTION_BANK : [];
  const STORAGE_KEY = "zhixu-bazi-study-v1";
  const SESSION_KEY = "zhixu-bazi-session-v2";
  const SCHEMA_VERSION = 2;
  const LETTERS = ["A", "B", "C", "D"];

  const CATEGORIES = {
    all: "全部",
    tiangan: "天干",
    dizhi: "地支",
    wuxing: "五行",
    shishen: "十神",
    hechong: "合冲刑害",
    canggan: "藏干",
    paipan: "排盘",
    relation: "关系判断",
    zonghe: "综合"
  };

  const MODES = {
    order: { label: "顺序练习", eyebrow: "顺序练习", size: Infinity },
    random: { label: "随机十题", eyebrow: "随机练习", size: 10 },
    wrong: { label: "错题重练", eyebrow: "错题重练", size: Infinity },
    exam: { label: "模拟考试", eyebrow: "模拟考试", size: 25 },
    retry: { label: "本轮错题", eyebrow: "本轮错题重练", size: Infinity }
  };

  const $ = (id) => document.getElementById(id);
  const dom = {
    modeNav: $("modeNav"),
    wrongModeCount: $("wrongModeCount"),
    categoryTabs: $("categoryTabs"),
    modeEyebrow: $("modeEyebrow"),
    pageHeading: $("pageHeading"),
    categoryCount: $("categoryCount"),
    lifetimeAnswered: $("lifetimeAnswered"),
    lifetimeAccuracy: $("lifetimeAccuracy"),
    masteredCount: $("masteredCount"),
    totalBankCount: $("totalBankCount"),
    quizView: $("quizView"),
    emptyState: $("emptyState"),
    resultView: $("resultView"),
    questionCounter: $("questionCounter"),
    progressTrack: $("progressTrack"),
    progressFill: $("progressFill"),
    progressPercent: $("progressPercent"),
    questionCategory: $("questionCategory"),
    questionKnowledge: $("questionKnowledge"),
    questionType: $("questionType"),
    questionText: $("questionText"),
    options: $("options"),
    feedback: $("feedback"),
    feedbackMark: $("feedbackMark"),
    feedbackTitle: $("feedbackTitle"),
    feedbackAnswer: $("feedbackAnswer"),
    feedbackRule: $("feedbackRule"),
    feedbackExplanation: $("feedbackExplanation"),
    selectionStatus: $("selectionStatus"),
    submitBtn: $("submitBtn"),
    nextBtn: $("nextBtn"),
    sessionStatus: $("sessionStatus"),
    sessionAnswered: $("sessionAnswered"),
    sessionCorrect: $("sessionCorrect"),
    sessionAccuracy: $("sessionAccuracy"),
    masteryList: $("masteryList"),
    resultPercent: $("resultPercent"),
    resultMode: $("resultMode"),
    resultTitle: $("resultTitle"),
    resultSummary: $("resultSummary"),
    resultBreakdown: $("resultBreakdown"),
    reviewSection: $("reviewSection"),
    reviewCount: $("reviewCount"),
    reviewList: $("reviewList"),
    retryWrongBtn: $("retryWrongBtn"),
    restartBtn: $("restartBtn"),
    exportBtn: $("exportBtn"),
    importInput: $("importInput"),
    resetBtn: $("resetBtn"),
    resetDialog: $("resetDialog"),
    confirmResetBtn: $("confirmResetBtn"),
    toast: $("toast"),
    elementWheel: $("elementWheel")
  };

  function defaultProgress() {
    return {
      version: SCHEMA_VERSION,
      lifetimeAnswered: 0,
      lifetimeCorrect: 0,
      questionStats: {},
      wrongIds: [],
      masteredIds: [],
      lastActiveAt: null
    };
  }

  function parseStoredJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Unable to parse ${key}`, error);
      return fallback;
    }
  }

  function normalizeProgress(value) {
    const base = defaultProgress();
    if (!value || typeof value !== "object") return base;
    const validIds = new Set(BANK.map((q) => q.id));
    const questionStats = {};
    if (value.questionStats && typeof value.questionStats === "object") {
      Object.entries(value.questionStats).forEach(([id, stats]) => {
        if (!validIds.has(id) || !stats || typeof stats !== "object") return;
        questionStats[id] = {
          attempts: Math.max(0, Number(stats.attempts) || 0),
          correct: Math.max(0, Number(stats.correct) || 0),
          incorrect: Math.max(0, Number(stats.incorrect) || 0),
          streak: Math.max(0, Number(stats.streak) || 0),
          lastAnsweredAt: typeof stats.lastAnsweredAt === "string" ? stats.lastAnsweredAt : null
        };
      });
    }
    return {
      version: SCHEMA_VERSION,
      lifetimeAnswered: Math.max(0, Number(value.lifetimeAnswered) || 0),
      lifetimeCorrect: Math.max(0, Number(value.lifetimeCorrect) || 0),
      questionStats,
      wrongIds: Array.isArray(value.wrongIds) ? value.wrongIds.filter((id) => validIds.has(id)) : [],
      masteredIds: Array.isArray(value.masteredIds) ? value.masteredIds.filter((id) => validIds.has(id)) : [],
      lastActiveAt: typeof value.lastActiveAt === "string" ? value.lastActiveAt : null
    };
  }

  let progress = normalizeProgress(parseStoredJson(STORAGE_KEY, defaultProgress()));
  let session = null;
  let toastTimer = null;

  function safeSave(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`Unable to save ${key}`, error);
      return false;
    }
  }

  function saveProgress() {
    progress.lastActiveAt = new Date().toISOString();
    safeSave(STORAGE_KEY, progress);
  }

  function serializableSession() {
    if (!session || session.finished) return null;
    return {
      version: SCHEMA_VERSION,
      mode: session.mode,
      category: session.category,
      questionIds: session.questions.map((q) => q.id),
      currentIndex: session.currentIndex,
      selected: session.selected,
      answers: session.answers,
      submitted: session.submitted,
      startedAt: session.startedAt
    };
  }

  function saveSession() {
    const value = serializableSession();
    if (!value) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    safeSave(SESSION_KEY, value);
  }

  function restoreSession() {
    const raw = parseStoredJson(SESSION_KEY, null);
    if (!raw || raw.version !== SCHEMA_VERSION || !MODES[raw.mode] || !CATEGORIES[raw.category]) return null;
    const byId = new Map(BANK.map((q) => [q.id, q]));
    const questions = Array.isArray(raw.questionIds) ? raw.questionIds.map((id) => byId.get(id)).filter(Boolean) : [];
    if (!questions.length) return null;
    const answers = raw.answers && typeof raw.answers === "object" ? raw.answers : {};
    const currentIndex = Math.min(Math.max(0, Number(raw.currentIndex) || 0), questions.length - 1);
    const selected = Array.isArray(raw.selected)
      ? [...new Set(raw.selected.filter((value) => Number.isInteger(value) && value >= 0 && value < 4))].sort((a, b) => a - b)
      : [];
    return {
      mode: raw.mode,
      category: raw.category,
      questions,
      currentIndex,
      selected,
      answers,
      submitted: Boolean(raw.submitted && answers[questions[currentIndex].id]),
      finished: false,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString()
    };
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function questionPool(category) {
    return category === "all" ? [...BANK] : BANK.filter((q) => q.category === category);
  }

  function buildQuestions(mode, category, explicitIds) {
    const byId = new Map(BANK.map((q) => [q.id, q]));
    if (explicitIds && explicitIds.length) return explicitIds.map((id) => byId.get(id)).filter(Boolean);
    let pool = questionPool(category);
    if (mode === "wrong") {
      const wrongSet = new Set(progress.wrongIds);
      pool = pool.filter((q) => wrongSet.has(q.id));
      return pool;
    }
    if (mode === "random" || mode === "exam") {
      return shuffle(pool).slice(0, Math.min(MODES[mode].size, pool.length));
    }
    return pool;
  }

  function newSession(mode, category, explicitIds) {
    session = {
      mode,
      category,
      questions: buildQuestions(mode, category, explicitIds),
      currentIndex: 0,
      selected: [],
      answers: {},
      submitted: false,
      finished: false,
      startedAt: new Date().toISOString()
    };
    saveSession();
    render();
  }

  function currentQuestion() {
    return session && session.questions[session.currentIndex];
  }

  function getSessionStats() {
    const answers = Object.values(session ? session.answers : {});
    const correct = answers.filter((answer) => answer.correct).length;
    return {
      answered: answers.length,
      correct,
      accuracy: answers.length ? Math.round((correct / answers.length) * 100) : 0
    };
  }

  function isExamMode() {
    return session && session.mode === "exam";
  }

  function choicesEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const normalizedLeft = [...left].sort((a, b) => a - b);
    const normalizedRight = [...right].sort((a, b) => a - b);
    return normalizedLeft.every((value, index) => value === normalizedRight[index]);
  }

  function formatChoiceLetters(choices) {
    return choices.map((index) => LETTERS[index]).join("、");
  }

  function formatChoiceText(question, choices) {
    return choices.map((index) => `${LETTERS[index]} · ${question.options[index]}`).join("；");
  }

  function updateProgressForAnswer(question, correct) {
    const now = new Date().toISOString();
    const stats = progress.questionStats[question.id] || {
      attempts: 0,
      correct: 0,
      incorrect: 0,
      streak: 0,
      lastAnsweredAt: null
    };
    stats.attempts += 1;
    stats.lastAnsweredAt = now;
    progress.lifetimeAnswered += 1;
    if (correct) {
      stats.correct += 1;
      stats.streak += 1;
      progress.lifetimeCorrect += 1;
      progress.wrongIds = progress.wrongIds.filter((id) => id !== question.id);
      if (stats.streak >= 2 && !progress.masteredIds.includes(question.id)) progress.masteredIds.push(question.id);
    } else {
      stats.incorrect += 1;
      stats.streak = 0;
      progress.masteredIds = progress.masteredIds.filter((id) => id !== question.id);
      if (!progress.wrongIds.includes(question.id)) progress.wrongIds.push(question.id);
    }
    progress.questionStats[question.id] = stats;
    saveProgress();
  }

  function selectOption(index) {
    if (!session || session.finished || session.submitted || !currentQuestion()) return;
    const question = currentQuestion();
    if (question.type === "multi") {
      session.selected = session.selected.includes(index)
        ? session.selected.filter((value) => value !== index)
        : [...session.selected, index].sort((a, b) => a - b);
    } else {
      session.selected = [index];
    }
    saveSession();
    renderQuestion();
  }

  function submitAnswer() {
    const question = currentQuestion();
    if (!question || session.submitted || session.selected.length === 0) return;
    const correct = choicesEqual(session.selected, question.answer);
    session.answers[question.id] = {
      choices: [...session.selected],
      correct,
      answeredAt: new Date().toISOString()
    };
    session.submitted = true;
    updateProgressForAnswer(question, correct);
    saveSession();
    render();
  }

  function nextQuestion() {
    if (!session || !session.submitted) return;
    if (session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1;
      const question = currentQuestion();
      const existing = question ? session.answers[question.id] : null;
      session.selected = existing ? [...existing.choices] : [];
      session.submitted = Boolean(existing);
      saveSession();
      render();
      requestAnimationFrame(() => dom.questionText.focus({ preventScroll: true }));
      return;
    }
    finishSession();
  }

  function finishSession() {
    if (!session) return;
    session.finished = true;
    localStorage.removeItem(SESSION_KEY);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchMode(mode) {
    if (!MODES[mode] || mode === "retry") return;
    newSession(mode, session ? session.category : "all");
  }

  function switchCategory(category) {
    if (!CATEGORIES[category]) return;
    const mode = session && session.mode !== "retry" ? session.mode : "order";
    newSession(mode, category);
  }

  function setVisibleView(view) {
    dom.quizView.hidden = view !== "quiz";
    dom.emptyState.hidden = view !== "empty";
    dom.resultView.hidden = view !== "result";
  }

  function renderChrome() {
    const mode = MODES[session.mode] || MODES.order;
    const categoryName = CATEGORIES[session.category] || CATEGORIES.all;
    const categoryTotal = questionPool(session.category).length;
    dom.modeEyebrow.textContent = `${mode.eyebrow} · ${categoryName}`;
    dom.pageHeading.textContent = session.finished ? "这一轮，你把哪些规则记牢了？" : "今天从哪一条规则开始？";
    dom.categoryCount.textContent = `${categoryTotal} 题`;
    document.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === session.mode || (session.mode === "retry" && button.dataset.mode === "wrong");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-category]").forEach((button) => {
      const active = button.dataset.category === session.category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    dom.wrongModeCount.textContent = progress.wrongIds.length ? `${progress.wrongIds.length} 道待复习` : "暂无错题";
  }

  function renderLifetimeStats() {
    const accuracy = progress.lifetimeAnswered ? Math.round((progress.lifetimeCorrect / progress.lifetimeAnswered) * 100) : 0;
    dom.lifetimeAnswered.textContent = String(progress.lifetimeAnswered);
    dom.lifetimeAccuracy.textContent = `${accuracy}%`;
    dom.masteredCount.textContent = String(progress.masteredIds.length);
    dom.totalBankCount.textContent = ` / ${BANK.length}`;
  }

  function renderSessionStats() {
    const stats = getSessionStats();
    dom.sessionAnswered.textContent = String(stats.answered);
    dom.sessionCorrect.textContent = String(stats.correct);
    dom.sessionAccuracy.textContent = `${stats.accuracy}%`;
    dom.sessionStatus.textContent = session.finished ? "已完成" : isExamMode() ? "答完统一判分" : "进行中";
  }

  function renderMastery() {
    const mastered = new Set(progress.masteredIds);
    dom.masteryList.innerHTML = Object.entries(CATEGORIES)
      .filter(([key]) => key !== "all")
      .map(([key, label]) => {
        const pool = questionPool(key);
        const count = pool.filter((q) => mastered.has(q.id)).length;
        const percentage = pool.length ? Math.round((count / pool.length) * 100) : 0;
        return `<div class="mastery-row"><span>${label}</span><span class="mastery-track"><i style="width:${percentage}%"></i></span><span>${count}/${pool.length}</span></div>`;
      })
      .join("");
  }

  function optionState(question, index) {
    if (!session.submitted || isExamMode()) return "";
    if (question.answer.includes(index)) return "正确答案";
    if (session.selected.includes(index)) return "你的答案";
    return "";
  }

  function renderQuestion() {
    const question = currentQuestion();
    if (!question) return;
    const total = session.questions.length;
    const index = session.currentIndex + 1;
    const percent = Math.max(1, Math.round((index / total) * 100));
    dom.questionCounter.textContent = `第 ${index} / ${total} 题`;
    dom.progressTrack.setAttribute("aria-valuemax", String(total));
    dom.progressTrack.setAttribute("aria-valuenow", String(index));
    dom.progressFill.style.width = `${percent}%`;
    dom.progressPercent.textContent = `${percent}%`;
    dom.questionCategory.textContent = CATEGORIES[question.category] || question.category;
    dom.questionKnowledge.textContent = question.knowledge;
    dom.questionType.textContent = question.type === "multi" ? "多选" : "单选";
    dom.questionType.classList.toggle("is-multi", question.type === "multi");
    dom.questionText.textContent = question.prompt;
    dom.questionText.setAttribute("tabindex", "-1");

    dom.options.innerHTML = question.options.map((option, optionIndex) => {
      const selected = session.selected.includes(optionIndex);
      const reveal = session.submitted && !isExamMode();
      const correct = reveal && question.answer.includes(optionIndex);
      const wrong = reveal && selected && !correct;
      const classes = ["option-button"];
      if (selected) classes.push("is-selected");
      if (correct) classes.push("is-correct");
      if (wrong) classes.push("is-wrong");
      const stateText = optionState(question, optionIndex);
      return `<button type="button" class="${classes.join(" ")}" data-option="${optionIndex}" aria-pressed="${selected}" ${session.submitted ? "disabled" : ""}><span class="option-letter">${LETTERS[optionIndex]}</span><span class="option-text">${escapeHtml(option)}</span><span class="option-state">${stateText}</span></button>`;
    }).join("");

    const answer = session.answers[question.id];
    const revealFeedback = Boolean(session.submitted && !isExamMode() && answer);
    dom.feedback.hidden = !revealFeedback;
    dom.feedback.classList.toggle("is-wrong", Boolean(revealFeedback && !answer.correct));
    if (revealFeedback) {
      dom.feedbackMark.textContent = answer.correct ? "✓" : "×";
      dom.feedbackTitle.textContent = answer.correct ? "回答正确" : "这题需要再看一次";
      dom.feedbackAnswer.textContent = answer.correct
        ? `你选择了 ${formatChoiceLetters(answer.choices)}，判断成立。`
        : `正确答案是 ${formatChoiceText(question, question.answer)}`;
      dom.feedbackRule.textContent = question.rule;
      dom.feedbackExplanation.textContent = question.explanation;
    }

    dom.submitBtn.hidden = session.submitted;
    dom.nextBtn.hidden = !session.submitted;
    dom.submitBtn.disabled = session.selected.length === 0;
    dom.nextBtn.textContent = index === total ? (isExamMode() ? "提交并查看成绩" : "查看本轮结果") : "下一题";
    if (!session.submitted) {
      if (session.selected.length === 0) {
        dom.selectionStatus.textContent = question.type === "multi" ? "本题可多选，请选择所有正确答案" : "请选择一个答案";
      } else {
        dom.selectionStatus.textContent = `已选择 ${formatChoiceLetters(session.selected)}，确认后提交`;
      }
    } else if (isExamMode()) {
      dom.selectionStatus.textContent = "答案已记录，考试结束后统一判分";
    } else {
      dom.selectionStatus.textContent = answer && answer.correct ? "已掌握一次，连续答对两次记为已掌握" : "已加入错题重练";
    }
  }

  function renderResult() {
    const stats = getSessionStats();
    const wrongQuestions = session.questions.filter((q) => session.answers[q.id] && !session.answers[q.id].correct);
    dom.resultPercent.textContent = String(stats.accuracy);
    dom.resultMode.textContent = `${MODES[session.mode].label} · 本轮完成`;
    dom.resultTitle.textContent = stats.accuracy === 100 ? "全部答对，规则很扎实" : stats.accuracy >= 80 ? "整体不错，重点再看错题" : "先把关键规则重新串起来";
    dom.resultSummary.textContent = `共作答 ${stats.answered} 题，答对 ${stats.correct} 题，答错 ${stats.answered - stats.correct} 题。`;

    const breakdown = Object.entries(CATEGORIES)
      .filter(([key]) => key !== "all")
      .map(([key, label]) => {
        const questions = session.questions.filter((q) => q.category === key && session.answers[q.id]);
        if (!questions.length) return "";
        const correct = questions.filter((q) => session.answers[q.id].correct).length;
        const percentage = Math.round((correct / questions.length) * 100);
        return `<div class="breakdown-row"><span>${label}</span><span class="breakdown-track"><i style="width:${percentage}%"></i></span><strong>${correct} / ${questions.length}</strong></div>`;
      })
      .join("");
    dom.resultBreakdown.innerHTML = breakdown || '<p class="review-perfect">本轮暂无可统计的分类。</p>';
    dom.reviewCount.textContent = `${wrongQuestions.length} 题`;
    dom.reviewList.innerHTML = wrongQuestions.length ? wrongQuestions.map((question) => {
      const answer = session.answers[question.id];
      return `<article class="review-item"><strong>${escapeHtml(question.prompt)}</strong><div class="review-answer"><span>你的答案：${escapeHtml(formatChoiceText(question, answer.choices))}</span><span>正确答案：${escapeHtml(formatChoiceText(question, question.answer))}</span></div><p>${escapeHtml(question.explanation)}</p></article>`;
    }).join("") : '<p class="review-perfect">本轮没有错题，继续保持。</p>';
    dom.retryWrongBtn.hidden = wrongQuestions.length === 0;
    dom.retryWrongBtn.dataset.ids = wrongQuestions.map((q) => q.id).join(",");
    dom.restartBtn.textContent = session.mode === "exam" ? "再考一组" : "再来一轮";
  }

  function render() {
    renderChrome();
    renderLifetimeStats();
    renderSessionStats();
    renderMastery();
    if (session.finished) {
      setVisibleView("result");
      renderResult();
      return;
    }
    if (!session.questions.length) {
      setVisibleView("empty");
      return;
    }
    setVisibleView("quiz");
    renderQuestion();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 2600);
  }

  function exportData() {
    const payload = {
      app: "知序八字基础刷题",
      exportedAt: new Date().toISOString(),
      version: SCHEMA_VERSION,
      progress
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `知序学习记录-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("学习记录已导出");
  }

  async function importData(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const source = payload && payload.progress ? payload.progress : payload;
      if (!source || typeof source !== "object") throw new Error("invalid");
      progress = normalizeProgress(source);
      saveProgress();
      newSession("order", "all");
      showToast("学习记录已导入");
    } catch (error) {
      showToast("无法导入：文件格式不正确");
    } finally {
      dom.importInput.value = "";
    }
  }

  function resetData() {
    progress = defaultProgress();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_KEY);
    newSession("order", "all");
    showToast("学习记录已清空");
  }

  function drawElementWheel() {
    const canvas = dom.elementWheel;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const cssSize = Math.max(180, Math.round(canvas.getBoundingClientRect().width || 220));
    canvas.width = cssSize * ratio;
    canvas.height = cssSize * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);
    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const radius = cssSize * 0.37;
    const nodes = [
      { element: "木", stems: "甲 乙", angle: -Math.PI / 2, color: "#79a493" },
      { element: "火", stems: "丙 丁", angle: -Math.PI / 2 + (Math.PI * 2) / 5, color: "#d77867" },
      { element: "土", stems: "戊 己", angle: -Math.PI / 2 + (Math.PI * 4) / 5, color: "#c5a361" },
      { element: "金", stems: "庚 辛", angle: -Math.PI / 2 + (Math.PI * 6) / 5, color: "#c0c8c3" },
      { element: "水", stems: "壬 癸", angle: -Math.PI / 2 + (Math.PI * 8) / 5, color: "#648c9a" }
    ].map((node) => ({ ...node, x: cx + Math.cos(node.angle) * radius, y: cy + Math.sin(node.angle) * radius }));

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(226,236,231,.26)";
    nodes.forEach((node, index) => {
      const next = nodes[(index + 1) % nodes.length];
      drawArrow(ctx, node.x, node.y, next.x, next.y, cssSize * 0.10);
    });
    ctx.strokeStyle = "rgba(209,107,93,.34)";
    [0, 2, 4, 1, 3].forEach((nodeIndex, index, order) => {
      const nextIndex = order[(index + 1) % order.length];
      drawArrow(ctx, nodes[nodeIndex].x, nodes[nodeIndex].y, nodes[nextIndex].x, nodes[nextIndex].y, cssSize * 0.11);
    });

    nodes.forEach((node) => {
      ctx.beginPath();
      ctx.arc(node.x, node.y, cssSize * 0.105, 0, Math.PI * 2);
      ctx.fillStyle = "#22312c";
      ctx.fill();
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#edf3ef";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(14, cssSize * 0.075)}px KaiTi, serif`;
      ctx.fillText(node.element, node.x, node.y - cssSize * 0.017);
      ctx.fillStyle = node.color;
      ctx.font = `${Math.max(8, cssSize * 0.038)}px Microsoft YaHei, sans-serif`;
      ctx.fillText(node.stems, node.x, node.y + cssSize * 0.055);
    });
    ctx.fillStyle = "#9aaba3";
    ctx.font = `${Math.max(9, cssSize * 0.042)}px Microsoft YaHei, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("相生 · 外环", cx, cy - 6);
    ctx.fillStyle = "#b87b70";
    ctx.fillText("相克 · 内星", cx, cy + 10);
  }

  function drawArrow(ctx, x1, y1, x2, y2, inset) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const startX = x1 + Math.cos(angle) * inset;
    const startY = y1 + Math.sin(angle) * inset;
    const endX = x2 - Math.cos(angle) * inset;
    const endY = y2 - Math.sin(angle) * inset;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    const head = 4;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * head, endY - Math.sin(angle - Math.PI / 6) * head);
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * head, endY - Math.sin(angle + Math.PI / 6) * head);
    ctx.stroke();
  }

  dom.modeNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button) switchMode(button.dataset.mode);
  });

  dom.categoryTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (button) switchCategory(button.dataset.category);
  });

  dom.options.addEventListener("click", (event) => {
    const button = event.target.closest("[data-option]");
    if (button) selectOption(Number(button.dataset.option));
  });

  dom.submitBtn.addEventListener("click", submitAnswer);
  dom.nextBtn.addEventListener("click", nextQuestion);
  dom.restartBtn.addEventListener("click", () => newSession(session.mode === "retry" ? "wrong" : session.mode, session.category));
  dom.retryWrongBtn.addEventListener("click", () => {
    const ids = dom.retryWrongBtn.dataset.ids.split(",").filter(Boolean);
    newSession("retry", session.category, ids);
  });
  document.querySelector("[data-empty-action='random']").addEventListener("click", () => newSession("random", session.category));
  dom.exportBtn.addEventListener("click", exportData);
  dom.importInput.addEventListener("change", () => importData(dom.importInput.files[0]));
  dom.resetBtn.addEventListener("click", () => dom.resetDialog.showModal());
  dom.confirmResetBtn.addEventListener("click", resetData);

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT" || dom.resetDialog.open) return;
    if (!session || session.finished || !currentQuestion()) return;
    if (!session.submitted && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      selectOption(Number(event.key) - 1);
    } else if (event.key === "Enter") {
      if (!session.submitted && session.selected.length > 0) {
        event.preventDefault();
        submitAnswer();
      } else if (session.submitted) {
        event.preventDefault();
        nextQuestion();
      }
    }
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(drawElementWheel.resizeTimer);
    drawElementWheel.resizeTimer = window.setTimeout(drawElementWheel, 120);
  });

  function init() {
    if (!BANK.length) console.error("Question bank is empty.");
    session = restoreSession();
    if (!session) newSession("order", "all");
    else render();
    drawElementWheel();
  }

  init();
})();
