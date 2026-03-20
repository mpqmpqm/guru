import fs from "fs";
import path from "path";

const SKILLS_ROOT = path.join(process.cwd(), "skills");
const SKILL_FILENAME = "SKILL.md";
const REFERENCES_DIRNAME = "references";
const INLINE_SKILL_ID = "cue";

interface ScannedReference {
  id: string;
  path: string;
  sizeBytes: number;
  title: string;
}

interface ScannedSkill {
  id: string;
  description: string;
  displayName: string;
  inline: boolean;
  instructionsPath: string;
  references: ScannedReference[];
  triggerHint: string | null;
}

interface SkillsCache {
  skills: Map<string, ScannedSkill>;
  orderedSkillIds: string[];
}

export interface SkillReferenceManifest {
  id: string;
  sizeBytes: number;
  title: string;
}

export interface SkillManifest {
  description: string;
  displayName: string;
  id: string;
  inline: boolean;
  references: SkillReferenceManifest[];
  triggerHint: string | null;
}

export interface LoadedSkill {
  instructions: string;
  references: SkillReferenceManifest[];
  skill_id: string;
}

export interface LoadedReference {
  content: string;
  reference_id: string;
  skill_id: string;
  title: string;
}

export interface SkillsCatalog {
  allSkills: SkillManifest[];
  foundationalSkill: SkillManifest | null;
  optionalCatalogText: string;
  optionalSkills: SkillManifest[];
}

let cachedSkills: SkillsCache | null = null;

function slugFromFilename(filename: string): string {
  return filename.replace(/\.md$/i, "").toLowerCase();
}

function parseFrontmatter(
  contents: string
): { attributes: Map<string, string>; body: string } {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { attributes: new Map(), body: contents };
  }

  const attributes = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const frontmatterMatch = line.match(
      /^([A-Za-z0-9_-]+):\s*(.+)$/
    );
    if (!frontmatterMatch) {
      continue;
    }

    const [, key, rawValue] = frontmatterMatch;
    attributes.set(
      key,
      rawValue.replace(/^['"]|['"]$/g, "").trim()
    );
  }

  return {
    attributes,
    body: contents.slice(match[0].length),
  };
}

function extractFirstHeading(markdown: string): string | null {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() ?? null;
}

function extractTriggerHint(description: string): string | null {
  const useWhenMatch = description.match(
    /\bUse when\b\s*([^.]*)\.?/i
  );
  if (!useWhenMatch) {
    return null;
  }

  const triggerHint = useWhenMatch[1].trim();
  return triggerHint.length > 0 ? triggerHint : null;
}

function readMarkdownFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function toReferenceManifest(
  reference: ScannedReference
): SkillReferenceManifest {
  return {
    id: reference.id,
    sizeBytes: reference.sizeBytes,
    title: reference.title,
  };
}

function toSkillManifest(skill: ScannedSkill): SkillManifest {
  return {
    description: skill.description,
    displayName: skill.displayName,
    id: skill.id,
    inline: skill.inline,
    references: skill.references.map(toReferenceManifest),
    triggerHint: skill.triggerHint,
  };
}

function renderReferenceList(
  references: SkillReferenceManifest[]
): string {
  if (references.length === 0) {
    return "none";
  }

  return references
    .map((reference) => `${reference.id} (${reference.title})`)
    .join(", ");
}

function renderOptionalCatalog(
  optionalSkills: SkillManifest[]
): string {
  if (optionalSkills.length === 0) {
    return "No optional skills are available.";
  }

  return optionalSkills
    .map((skill) => {
      const lines = [
        `- ${skill.id}: ${skill.displayName}`,
        `  description: ${skill.description}`,
        `  references: ${renderReferenceList(skill.references)}`,
      ];

      if (skill.triggerHint) {
        lines.splice(
          2,
          0,
          `  use when: ${skill.triggerHint}`
        );
      }

      return lines.join("\n");
    })
    .join("\n");
}

function scanReferences(skillDir: string): ScannedReference[] {
  const referencesDir = path.join(skillDir, REFERENCES_DIRNAME);
  if (!fs.existsSync(referencesDir)) {
    return [];
  }

  return fs
    .readdirSync(referencesDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".md")
    )
    .map((entry) => {
      const referencePath = path.join(referencesDir, entry.name);
      const content = readMarkdownFile(referencePath);
      const title =
        extractFirstHeading(content) ?? slugFromFilename(entry.name);

      return {
        id: slugFromFilename(entry.name),
        path: referencePath,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        title,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function scanSkills(): SkillsCache {
  const skills = new Map<string, ScannedSkill>();
  const orderedSkillIds = fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".")
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const skillId of orderedSkillIds) {
    const skillDir = path.join(SKILLS_ROOT, skillId);
    const instructionsPath = path.join(skillDir, SKILL_FILENAME);
    if (!fs.existsSync(instructionsPath)) {
      continue;
    }

    const instructions = readMarkdownFile(instructionsPath);
    const { attributes, body } = parseFrontmatter(instructions);
    const description = attributes.get("description");
    const displayName = extractFirstHeading(body);
    if (!description || !displayName) {
      throw new Error(
        `Skill "${skillId}" is missing required metadata in ${instructionsPath}`
      );
    }

    skills.set(skillId, {
      id: skillId,
      description,
      displayName,
      inline: skillId === INLINE_SKILL_ID,
      instructionsPath,
      references: scanReferences(skillDir),
      triggerHint: extractTriggerHint(description),
    });
  }

  return { skills, orderedSkillIds };
}

function getCache(): SkillsCache {
  if (!cachedSkills) {
    cachedSkills = scanSkills();
  }
  return cachedSkills;
}

function getScannedSkill(skillId: string): ScannedSkill {
  const skill = getCache().skills.get(skillId);
  if (!skill) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return skill;
}

export function primeSkillsCatalog(): SkillsCatalog {
  cachedSkills = scanSkills();
  return getSkillsCatalog();
}

export function getSkillsCatalog(): SkillsCatalog {
  const cache = getCache();
  const allSkills = cache.orderedSkillIds
    .map((skillId) => cache.skills.get(skillId))
    .filter((skill): skill is ScannedSkill => skill !== undefined)
    .map(toSkillManifest);
  const foundationalSkill =
    allSkills.find((skill) => skill.inline) ?? null;
  const optionalSkills = allSkills.filter(
    (skill) => !skill.inline
  );

  return {
    allSkills,
    foundationalSkill,
    optionalCatalogText: renderOptionalCatalog(optionalSkills),
    optionalSkills,
  };
}

export function loadSkill(skillId: string): LoadedSkill {
  const skill = getScannedSkill(skillId);
  const instructions = readMarkdownFile(skill.instructionsPath);

  return {
    instructions,
    references: skill.references.map(toReferenceManifest),
    skill_id: skill.id,
  };
}

export function loadOptionalSkill(skillId: string): LoadedSkill {
  const skill = getScannedSkill(skillId);
  if (skill.inline) {
    throw new Error(
      `Skill "${skillId}" is foundational and should be inlined, not loaded dynamically`
    );
  }
  return loadSkill(skillId);
}

export function loadReference(
  skillId: string,
  referenceId: string
): LoadedReference {
  const skill = getScannedSkill(skillId);
  const reference = skill.references.find(
    (entry) => entry.id === referenceId
  );
  if (!reference) {
    throw new Error(
      `Unknown reference "${referenceId}" for skill "${skillId}"`
    );
  }

  return {
    content: readMarkdownFile(reference.path),
    reference_id: reference.id,
    skill_id: skill.id,
    title: reference.title,
  };
}
