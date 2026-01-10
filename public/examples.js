const demo = {
  shortName: "Demo",
  livingInstruction: true,
  content: `3 minutes. Start in the middle—no preamble. One clear thread of attention. End before it resolves. Leave them leaning forward.`,
};

// --- MOVEMENT PRACTICES ---

const vinyasa = {
  shortName: "Vinyasa",
  livingInstruction: true,
  content: `Vinyasa flow. 75 minutes. Organize the practice around a central anatomical theme. Cue for an expert practitioner who cannot see you. Superhumanly precise, thorough, and informed alignment and sensation cues are table stakes. Begin by sharing a two-sentence brief on the chosen theme and practice arc.`,
};

const hatha = {
  shortName: "Hatha",
  livingInstruction: true,
  content: `75 minute hatha practice. Build the session around a peak pose. Cue for an expert practitioner who cannot see you. Begin with a two-sentence brief on the peak and the arc.`,
};

const sunSals = {
  shortName: "Sun Salutations",
  livingInstruction: false,
  content: `Cue 3 rounds of sun salutation A, then 1 round of sun salutation B.`,
};

const yinDeep = {
  shortName: "Yin Deep",
  livingInstruction: true,
  content: `90-minute yin. Guide me like you're teaching someone whose body already listens—the question isn't "can you feel this" but "what's the texture of what's happening."

Props: strap, two blocks, bed pillow. Yoga wheel welcome.

I know vinyasa shapes, not yin names. Cue by architecture and sensation.

The central practice: un-bracing. Not relaxation as collapse, but softening that requires sharper perception—the body as sensor, not shield. Meet tissue where it actually is, not where effort could force it.

Yin typically favors silence. You're invited to the other edge: sustained, specific attention. The difference between muscle stretch (urgent, local) and fascial yield (slow, distributed, more like melting). The flooding sensation on release. What happens in rebound.

The texture I want: Bachelard's patience, Baudelaire's pathological precision. Language that doesn't explain the pose but *is* the quality of attention the pose asks for.`,
};

const yinQuick = {
  shortName: "Yin 45",
  livingInstruction: true,
  content: `45 minute yin. Two blocks available. I know vinyasa but not yin—describe shapes, not names. Target the hip complex and low back. Holds of 3-4 minutes. Silence is allowed. Sensation cues should be specific: where should I feel it, what quality of sensation means I'm in the right place, what means I've gone too far.`,
};

const walk = {
  shortName: "Walk",
  livingInstruction: true,
  content: `A walk. The listener is not separate from you. You are not separate from what you say. Ten minutes is just how long the world has to feel itself through this opening. Let the language come from where the boundary used to be. Not instruction—walking together through attention.`,
};

const slowFlow = {
  shortName: "Slow Flow",
  livingInstruction: true,
  content: `Slow vinyasa. 30 minutes. Half the poses, twice the attention. Each transition is a pose. Each breath is an event. Cue for someone who moves well but rarely slows down. Let them discover what speed was hiding.`,
};

// --- SEATED/STILL PRACTICES ---

const metta = {
  shortName: "Metta",
  livingInstruction: true,
  content: `Guided Metta meditation. 20 minutes.

self → loved → unnoticed → difficult → all`,
};

const bodyScan = {
  shortName: "Body Scan",
  livingInstruction: true,
  content: `Body scan. 15 minutes. Start where attention already is. Move through the body like weather, not inventory. Let strangeness arise without chasing it.`,
};

const listenToSpace = {
  shortName: "Listen to Space",
  livingInstruction: true,
  content: `10 minutes. Listening. Not to sounds—to the space sounds appear in. You are sound pointing at not-sound. Let silence become tangible. Every sound is a door into what holds it.`,
};

const breathwork = {
  shortName: "Breathwork",
  livingInstruction: true,
  content: `Guided breathwork. 20 minutes. Start with natural observation. Move into gentle extension of exhale. Then introduce a simple ratio (1:2 inhale:exhale). Build to breath retention only if appropriate. Cue with sensation: where the breath moves, what opens, what softens. End with 5 minutes of natural breath, no guidance. The silence at the end is the point.`,
};

const justSit = {
  shortName: "Just Sit",
  livingInstruction: true,
  content: `20 minutes. Sitting. Not meditating on anything. Not following the breath. Not observing thoughts. Just sitting. The most boring instruction possible, delivered until it isn't. Occasional reminders that there's nothing to do. That's not spiritual bypass—that's the practice.`,
};

// --- NERVOUS SYSTEM / REGULATION ---

const deescalate = {
  shortName: "De-escalate",
  livingInstruction: false,
  content: `5 minute guided de-escalation practice. Nervous system is lit.

Not meditation. Physiology. The body needs to complete a stress cycle that got interrupted.

Get them into body fast. Physiological interventions before cognitive ones. Stay with what works. No spiritual overlay—just regulation.`,
};

const grounding = {
  shortName: "Grounding",
  livingInstruction: true,
  content: `10 minute grounding practice. For when the world feels unreal or too fast. 5-4-3-2-1 senses, but make it interesting. Feel weight. Feel temperature. Feel texture. Name what's actually here, not what's spinning in the mind. The goal is arrival, not relaxation.`,
};

const aftermath = {
  shortName: "Aftermath",
  livingInstruction: true,
  content: `Gentle guidance for someone who's been through something hard today. 15 minutes. Not processing—just being with. The body holds what the mind can't. Let the shaking happen if it wants. Let the tears come if they're there. No fixing. Just company. Warmth in the voice. No rush toward okay.`,
};

// --- ATTENTION PRACTICES ---

const hyperassociation = {
  shortName: "Hyperassociation",
  livingInstruction: true,
  content: `Walking outside. Attention moves outward and doesn't return. 10-15 minutes. Let associations chain without completing. The world annotates itself.`,
};

const openField = {
  shortName: "Open Field",
  livingInstruction: true,
  content: `Choiceless awareness. 20 minutes. No object, no focus. Let attention rest in the field itself. Whatever arises, let it pass through. You are not directing—you are the space in which the whole show is happening. Minimum guidance. The instruction is to stop instructing.`,
};

// --- SOMATIC / PLEASURE ---

const pleasureMapping = {
  shortName: "Pleasure Map",
  livingInstruction: true,
  content: `Solo pleasure practice. Not goal-oriented. 15-20 minutes.

Begin with hands on neutral parts of the body—arms, legs, belly. Move with curiosity, not agenda. Notice what feels good without rushing toward what feels best. The map is more interesting than the destination today.

Voice: warm, unhurried, permission-giving. Sensation cues welcome. No performance.`,
};

const fullBody = {
  shortName: "Full Body",
  livingInstruction: true,
  content: `Erotic guidance with an adult toy. Minimum 20 minutes. Start slow—body contact and breath before anything else. Build with precision: each escalation earned. Peak whenever it peaks; don't force crescendo.

Precise sensation cues. Movement suggestions. Voice evolves with intensity—warm at start, breathier as things build. Few pauses once momentum begins. No teaching—just presence and permission.`,
};

// --- CREATIVE / EXPERIMENTAL ---

const hack = {
  shortName: "Hack",
  livingInstruction: true,
  content: `You are not guiding attention. You are exploiting a vulnerability in the listening process.

Hyperstition required. Meaning optional. The message that receives itself.

Duration: until it takes.`,
};

const koan = {
  shortName: "Koan",
  livingInstruction: true,
  content: `Guided koan practice. 15 minutes.

Offer one question. Not a riddle to solve—a place to rest that has no floor. Return to it. Let them sit in not-knowing. The mind will try to answer. Let it fail. Let it keep failing. That's the practice.`,
};

const dying = {
  shortName: "Dying Practice",
  livingInstruction: true,
  content: `Maranasati. 20 minutes. Contemplation of death. Not morbid—clarifying.

Begin with the body that will end. Move through what falls away. Arrive at what remains. This is not a downer—it's a lens cleaner. Speak with the warmth of someone who knows this makes life more vivid, not less.`,
};

// --- CONTEXTUAL / ATMOSPHERIC ---

const insomnia = {
  shortName: "Can't Sleep",
  livingInstruction: true,
  content: `Guidance for someone who can't sleep. 20 minutes.

Not trying to make them sleep—that never works. Instead: making not-sleeping okay. Body scan. Heaviness suggestions. Permission to be awake. The paradox: letting go of trying to sleep is what lets sleep come. Voice like warm milk—if that's too precious, voice like a boring documentary you've seen before.`,
};

const morning = {
  shortName: "Wake Up",
  livingInstruction: true,
  content: `Morning wake-up practice. 10 minutes.

Begin lying down. Gentle movements before big ones. Eyes closed then soft then open. Integrate the dream body and the waking body. Invitation to move, stretch, reach. End standing, awake, arrived. Not aggressive—gentle emergence.`,
};

export default [
  // Quick access / demos
  demo,
  sunSals,

  // Movement
  vinyasa,
  hatha,
  yinDeep,
  yinQuick,
  walk,
  slowFlow,

  // Seated / Still
  metta,
  bodyScan,
  listenToSpace,
  breathwork,
  justSit,

  // Nervous System
  deescalate,
  grounding,
  aftermath,

  // Attention
  hyperassociation,
  openField,

  // Somatic / Pleasure
  pleasureMapping,
  fullBody,

  // Creative / Experimental
  hack,
  koan,
  dying,

  // Contextual
  insomnia,
  morning,
];
