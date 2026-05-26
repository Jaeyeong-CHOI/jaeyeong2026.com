const { useState, useEffect, useRef } = React;

// ============= DATA =============
const NAV = [
  { id: 'intro', label: 'Introduction' },
  { id: 'about', label: 'About' },
  { id: 'research', label: 'Research' },
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'awards', label: 'Awards' },
  { id: 'certs', label: 'Certifications' },
  { id: 'conferences', label: 'Conferences' },
  { id: 'contact', label: 'Contact' },
];

const FOCUS = [
  { tag: 'Primary', title: 'Large Language Models', desc: 'Multi-modal LLMs, RAG agents, robust temporal grounding for omnimodal models.' },
  { tag: 'Primary', title: 'AI × Education', desc: 'Designing AI-augmented learning systems and simulation environments for science classrooms.' },
  { tag: 'Adjacent', title: 'HCI & Researcher Identity', desc: 'How interdisciplinary backgrounds shape HCI research approaches (CHI submission in prep).' },
  { tag: 'Exploration', title: 'AI-Resistant Programming Languages', desc: 'Systematically designing languages whose linguistic structures cause LLM generalization to fail.' },
];

const RESEARCH = [
  {
    meta: 'Ongoing · First author',
    title: 'AVRTG — Audio Visual Robustness Temporal Grounding',
    role: 'Lead researcher · Internal university research project',
    body: 'Robust audio-visual temporal grounding for omnimodal models. Generating synthetic data based on VGGSound and FineVideo datasets, and using it to train and evaluate models that align temporal cues across modalities.',
    chips: ['Omnimodal', 'Synthetic Data', 'VGGSound', 'FineVideo', 'Temporal Grounding'],
  },
  {
    meta: 'In prep · Second author',
    title: 'Interdisciplinary Identity of HCI Researchers',
    role: 'DIAG, Yonsei University · Targeting ACM CHI',
    body: 'Investigating how diverse academic backgrounds shape research approaches and contributions in Human-Computer Interaction. Currently preparing the manuscript for submission to the ACM CHI Conference.',
    chips: ['HCI', 'Qualitative', 'CHI 2026'],
  },
  {
    meta: 'Planning',
    title: 'LLM-Based Social Science Simulation',
    role: 'Cross-lab collaboration · HCI perspective',
    body: 'Built a simulation system for social science research using the Nemotron-Personas-Korea dataset and Upstage Solar. Planning to study the system from an HCI perspective with a senior Ph.D. collaborator.',
    chips: ['Solar', 'Nemotron-Personas-Korea', 'Agent Simulation'],
  },
  {
    meta: 'Exploration',
    title: 'Programming Languages AI Cannot Solve',
    role: 'Independent · From a coursework prompt',
    body: 'Designed a new programming language whose syntax can be easily confused with Python — and that AI models fail to solve. Now developing it into a research project: using AI agents to generate new languages and compilers, and probing where models fail to generalize.',
    chips: ['Code LLM', 'Compilers', 'Adversarial', 'Generalization'],
  },
];

const EXPERIENCE = [
  {
    date: '2026 — Now',
    title: 'Upstage AI Ambassador',
    org: 'Upstage',
    desc: 'Community ambassador for Upstage AI, contributing to outreach and developer engagement around Korean LLMs.',
    now: true,
  },
  {
    date: '2026 — Now',
    title: 'DLI Certified Instructor',
    org: 'NVIDIA Deep Learning Institute',
    desc: 'Certified instructor for "Building RAG Agents with LLMs", delivering hands-on technical training.',
    now: true,
  },
  {
    date: 'Oct 2025 — Now',
    title: 'Undergraduate Researcher (LLM, Multi-Modal)',
    org: 'LaMI Lab, DGIST',
    desc: 'Researching multi-modal large language models; current focus on robust audio-visual temporal grounding.',
    now: true,
  },
  {
    date: 'Sep 2025 — Now',
    title: 'SW Development Intern (AI Agent, RAG)',
    org: 'SEMES — Smart EQ, SW Center',
    desc: 'Building production-oriented AI agents and Retrieval-Augmented Generation pipelines for industrial use.',
    now: true,
  },
  {
    date: 'Mar — Aug 2025',
    title: 'Research Assistant · Undergraduate Intern',
    org: 'DIAG, Yonsei University (Incheon)',
    desc: 'HCI research on the interdisciplinary nature of researcher identities. Preparing a paper as second author, targeting ACM CHI.',
  },
  {
    date: 'Sep 2023 — Jun 2024',
    title: 'Research Assistant · Undergraduate Intern',
    org: 'DIAG, DGIST',
    desc: 'Planned an AI-driven audit system under MSIT Audit Office supervision. Augmented linguistic corpus data for an NIA-funded project. Studied the intersection of LLMs and education through qualitative open coding. Attended HCI Korea 2024.',
  },
  {
    date: 'Apr 2022 — Aug 2023',
    title: 'Project Manager · EdTech Simulation Platform',
    org: 'Quester, Daegu',
    desc: 'Initiated and led a Unity-based virtual experiment platform for science education. Coordinated developers, teachers, and vendors. Oversaw demonstrations at teacher-training programs and pilot trials in high schools.',
  },
];

const PROJECTS = [
  {
    num: '01',
    kind: 'EdTech · Unity · PM',
    title: 'Play the LAB (PLAB)',
    body: 'Led the end-to-end development of an interactive Unity-based educational platform enabling students to conduct science experiments in immersive virtual environments.',
    bullets: [
      'Initiated proposal and oversaw the full project lifecycle as PM',
      'Demoed during teacher training at Ewha & Seoul Women\'s University',
      'Piloted in three high schools to validate effectiveness with real students',
    ],
  },
  {
    num: '02',
    kind: 'Community · AI Education',
    title: 'NAVER CONNECT SW Camp',
    body: 'Led a volunteer team teaching AI to elementary schoolers — designing educational programs and managing social media outreach.',
    bullets: [
      'Designed AI curricula for K-6 learners',
      'Ran summer and winter camps across multiple schools',
      'Recognized as an Outstanding Club by NAVER CONNECT (2024)',
    ],
  },
];

const AWARDS = [
  { yr: '2024', name: 'Outstanding Training Award', by: 'Korea Air Force Basic Military Training Center' },
  { yr: '2024', name: 'Software Sprout Camp Outstanding Club Award', by: 'NAVER CONNECT' },
  { yr: '2021', name: 'Hanwha Science Challenge Bronze Award', by: 'Hanwha Group' },
  { yr: '2020', name: 'Youth Content Dream Support Project Grand Prize', by: 'Chungnam Content Korea Lab' },
];

const CERTS = [
  { name: 'Building RAG Agents with LLMs', org: 'NVIDIA DLI', dt: 'Aug 2025', url: 'https://learn.nvidia.com/certificates?id=Ve6uqyAkTVOBXXu8jmiatg' },
  { name: 'Getting Started with AI on Jetson Nano', org: 'NVIDIA DLI', dt: 'Jul 2025', url: 'https://learn.nvidia.com/certificates?id=yIeYKJE3Tvu-AtXYMXFlxA#' },
  { name: 'H-Mobility Class: Autonomous Driving — Perception Track', org: 'Hyundai NGV', dt: 'Jun 2025', url: 'https://edu.hyundai-ngv.com/mypage/certificate.jsp?cuid=1473720' },
  { name: 'Building Conversational AI Applications', org: 'NVIDIA DLI', dt: 'Jan 2024', url: 'https://courses.nvidia.com/certificates/9dac6ad824cf4089b77359b4c5c34f96' },
  { name: 'Building Transformer-Based NLP Applications', org: 'NVIDIA DLI', dt: 'Jan 2024', url: 'https://courses.nvidia.com/certificates/181ca8a4ec5d4d40a3111ad4da8ba1ee' },
  { name: 'Computer Vision for Industrial Inspection', org: 'NVIDIA DLI', dt: 'Jan 2024', url: 'https://courses.nvidia.com/certificates/ca11e3ca118442cb978b5575c28167b2' },
];

const CONFS = [
  { dt: '06 Jan 2026', nm: 'DevFest 2025', hs: 'GDG Incheon' },
  { dt: '30 Dec 2025', nm: 'DevFest 2025', hs: 'GDG Cloud / Seoul' },
  { dt: '19–20 Dec 2025', nm: 'Fall Conference 2025', hs: 'KAIA' },
  { dt: '18 Dec 2025', nm: 'AI DAY Seoul 2025', hs: 'NVIDIA' },
  { dt: '06 Dec 2025', nm: 'DAN25', hs: 'NAVER' },
  { dt: '24 Sep 2025', nm: 'if(Kakao)25', hs: 'Kakao' },
  { dt: '21 Jun 2025', nm: 'Build with AI', hs: 'MODULABS · AIFFEL' },
];

const CV_URL = 'uploads/cv.pdf';

// ============= ICONS =============
const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 12 L12 4 M6 4 H12 V10" strokeLinecap="round" strokeLinejoin="round"/></svg>
);
const Mail = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="m2.5 4.5 5.5 4 5.5-4" strokeLinecap="round"/></svg>
);

// ============= APP =============
function App() {
  const [active, setActive] = useState('intro');

  useEffect(() => {
    const sections = NAV.map(n => document.getElementById(n.id)).filter(Boolean);
    const onScroll = () => {
      const y = window.scrollY + 200;
      let curr = sections[0]?.id;
      for (const s of sections) {
        if (s.offsetTop <= y) curr = s.id;
      }
      if (curr) setActive(curr);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (id) => (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.offsetTop - 30, behavior: 'smooth' });
  };

  return (
    <div className="shell">
      <Sidebar active={active} go={go} />
      <main>
        <Hero />
        <About />
        <Research />
        <Experience />
        <Projects />
        <Awards />
        <Certifications />
        <Conferences />
        <Contact />
        <Footer />
      </main>
    </div>
  );
}

function Sidebar({ active, go }) {
  return (
    <aside>
      <div>
        <div className="brand-mark">J</div>
        <div style={{ marginTop: 16 }}>
          <div className="brand-name">Jae Y. Choi</div>
          <div className="brand-role">NLP & AI · Researcher</div>
        </div>
      </div>

      <nav className="toc">
        {NAV.map((n, i) => (
          <a key={n.id} href={`#${n.id}`} onClick={go(n.id)} className={active === n.id ? 'active' : ''}>
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span className="bar"></span>
            <span>{n.label}</span>
          </a>
        ))}
      </nav>

      <div className="side-foot">
        <div><span className="status-dot"></span>Open to collaborations</div>
        <div style={{ marginTop: 14, lineHeight: 1.9 }}>
          <div>DGIST · Computer Science</div>
          <div>Daegu, South Korea</div>
          <div style={{ marginTop: 10 }}>
            <a href="mailto:jaeyeong2022@dgist.ac.kr">jaeyeong2022@dgist.ac.kr</a>
          </div>
          <div>
            <a href="https://www.linkedin.com/in/jaeychoi2022/" target="_blank" rel="noopener">linkedin.com/in/jaeychoi2022</a>
          </div>
          <div>
            <a href={CV_URL} target="_blank" rel="noopener">Download CV</a>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Hero() {
  return (
    <section id="intro" className="hero">
      <div className="hello reveal">
        <span className="pill">Available · Spring 2026</span>
        <span>NLP & AI Research · Undergraduate</span>
      </div>
      <h1 className="hero-title reveal" style={{ animationDelay: '.05s' }}>
        Building <em>technology</em> that<br/>brings <em>meaningful</em> value<br/>to people.
      </h1>
      <p className="hero-blurb reveal" style={{ animationDelay: '.15s' }}>
        I'm a third-year CS undergraduate at DGIST working at the intersection of
        large language models, multi-modality, and education. I'm cultivating a wide,
        interdisciplinary skill set in the belief that breadth will let me offer
        genuinely fresh perspectives on the problems I care about.
      </p>

      <div className="hero-meta reveal" style={{ animationDelay: '.2s' }}>
        <div className="cell"><div className="k">Affiliation</div><div className="v">DGIST · LaMI Lab</div></div>
        <div className="cell"><div className="k">Focus</div><div className="v">LLMs · Multi-modal</div></div>
        <div className="cell"><div className="k">Year</div><div className="v">3rd · 2022 →</div></div>
        <div className="cell"><div className="k">GPA</div><div className="v">3.76 / 4.30</div></div>
      </div>

      <div className="hero-cta reveal" style={{ animationDelay: '.3s' }}>
        <a className="btn" href="mailto:jaeyeong2022@dgist.ac.kr"><Mail/>Get in touch</a>
        <a className="btn ghost" href={CV_URL} target="_blank" rel="noopener">CV<Arrow/></a>
        <a className="btn ghost" href="https://www.linkedin.com/in/jaeychoi2022/" target="_blank" rel="noopener">LinkedIn<Arrow/></a>
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about">
      <div className="eyebrow">01 — About</div>
      <h2 className="section-title">A researcher driven by <em>impact</em>, not just curiosity.</h2>
      <div className="twocol">
        <div>
          <p>
            My primary interests lie in <strong>education</strong> and <strong>large language models</strong>.
            I aspire to propose and build technologies that make a meaningful impact —
            services that bring genuine value to the people who use them.
          </p>
          <p>
            I'm currently a third-year Computer Science undergraduate at DGIST,
            and spent a winter semester as an exchange student in Electrical and Computer
            Engineering at Seoul National University, focusing on AI and neural networks.
          </p>
        </div>
        <div>
          <p>
            I work across labs and modalities — from omnimodal grounding at LaMI Lab,
            to RAG agents at SEMES, to HCI research at DIAG. Each role
            sharpens a different lens; together they shape how I approach problems.
          </p>
          <p>
            I'm also a DLI Certified Instructor at NVIDIA and an Upstage AI Ambassador —
            roles I treat as a duty to make AI knowledge accessible.
          </p>
        </div>
      </div>

      <div className="focus-grid">
        {FOCUS.map((f, i) => (
          <div className="focus-card" key={i}>
            <div className="tag">{f.tag}</div>
            <h4>{f.title}</h4>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Research() {
  return (
    <section id="research">
      <div className="eyebrow">02 — Research</div>
      <h2 className="section-title">Selected <em>projects</em> & directions.</h2>
      <div>
        {RESEARCH.map((r, i) => (
          <div className="research-item" key={i}>
            <div className="meta-mono">{r.meta}</div>
            <div>
              <h3>{r.title}</h3>
              <div className="role-line">{r.role}</div>
              <p>{r.body}</p>
              <div className="chips">
                {r.chips.map(c => <span className="chip" key={c}>{c}</span>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Experience() {
  return (
    <section id="experience">
      <div className="eyebrow">03 — Experience</div>
      <h2 className="section-title">Where I've been <em>building</em> & <em>researching</em>.</h2>
      <div className="timeline">
        {EXPERIENCE.map((e, i) => (
          <div className={`t-item ${e.now ? 'active' : ''}`} key={i}>
            <div className="t-date">{e.date}</div>
            <div className="t-title">{e.title}</div>
            <div className="t-org">
              {e.now && <span className="now-dot"></span>}
              {e.org}
            </div>
            <div className="t-desc">{e.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Projects() {
  return (
    <section id="projects">
      <div className="eyebrow">04 — Project Portfolio</div>
      <h2 className="section-title">Shipped <em>products</em>, taught <em>students</em>.</h2>
      <div className="proj-grid">
        {PROJECTS.map((p, i) => (
          <div className="proj-card" key={i}>
            <div className="head">
              <span>{p.num}</span>
              <span>{p.kind}</span>
            </div>
            <h4>{p.title}</h4>
            <p>{p.body}</p>
            <ul style={{ paddingLeft: 18, margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>
              {p.bullets.map(b => <li key={b}>{b}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Awards() {
  return (
    <section id="awards">
      <div className="eyebrow">05 — Awards & Honors</div>
      <h2 className="section-title">Recognized <em>work</em>.</h2>
      <div className="awards-list">
        {AWARDS.map((a, i) => (
          <div className="award-row" key={i}>
            <div className="yr">{a.yr}</div>
            <div className="name">{a.name}</div>
            <div className="by">{a.by}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Certifications() {
  return (
    <section id="certs">
      <div className="eyebrow">06 — Certifications</div>
      <h2 className="section-title">Recent <em>credentials</em>.</h2>
      <div className="cert-list">
        {CERTS.map((c, i) => (
          <a className="cert-row" key={i} href={c.url} target="_blank" rel="noopener">
            <div className="cn">{c.name}</div>
            <div className="org">{c.org}</div>
            <div className="dt">{c.dt} <span className="arrow" style={{ display: 'inline-block', marginLeft: 4 }}><Arrow/></span></div>
          </a>
        ))}
      </div>
    </section>
  );
}

function Conferences() {
  return (
    <section id="conferences">
      <div className="eyebrow">07 — Participation Record</div>
      <h2 className="section-title">Where I <em>show up</em>.</h2>
      <p style={{ maxWidth: 580 }}>Conferences and developer events I've attended over the past year — a habit of being where the field moves.</p>
      <div className="conf-grid">
        {CONFS.map((c, i) => (
          <div className="conf-card" key={i}>
            <div className="dt">{c.dt}</div>
            <div className="nm">{c.nm}</div>
            <div className="hs">{c.hs}</div>
          </div>
        ))}
        <div className="conf-more">to be continued · 🔥</div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact">
      <div className="eyebrow">08 — Contact</div>
      <div className="contact-card">
        <h2>Let's <em>build</em><br/>something together.</h2>
        <p>
          I'm always open to collaborations on LLM research, AI-for-education projects,
          and HCI studies. If any of that overlaps with your work, please reach out.
        </p>
        <div className="contact-links">
          <a className="contact-link" href="mailto:jaeyeong2022@dgist.ac.kr">
            <span className="lbl">Email</span>
            <span className="val">jaeyeong2022@dgist.ac.kr</span>
          </a>
          <a className="contact-link" href="tel:+821095831171">
            <span className="lbl">Phone</span>
            <span className="val">+82 10-9583-1171</span>
          </a>
          <a className="contact-link" href="https://www.linkedin.com/in/jaeychoi2022/" target="_blank" rel="noopener">
            <span className="lbl">LinkedIn</span>
            <span className="val">/in/jaeychoi2022</span>
          </a>
          <a className="contact-link" href={CV_URL} target="_blank" rel="noopener">
            <span className="lbl">CV</span>
            <span className="val">Download PDF</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div>© 2026 Jae Y. Choi — Daegu, South Korea</div>
      <div>Last updated · May 2026</div>
    </footer>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
