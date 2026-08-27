import { profileSchema, ru, type AgeGroup, type ProfileInput } from '@rolemate/shared';

const quickStart = ru.miniApp.quickStart;

export interface QuickStartAnswers {
  displayName: string;
  ageGroup: AgeGroup;
  lookingFor: string[];
  formats: string[];
  hook: string;
  timezone?: string;
}

/**
 * The questionnaire needs an "about" of at least forty characters. Composing one
 * from the three answers keeps the card readable instead of padding it with filler.
 */
function composeAbout(hook: string, lookingFor: string[], formats: string[]): string {
  const composed = quickStart.aboutTemplate(hook, lookingFor, formats);
  return composed.length >= 40 ? composed : `${composed} ${quickStart.aboutFallback}`;
}

function writingStyle(formats: string[]): ProfileInput['writingStyle'] {
  if (formats.includes(quickStart.formatOptions[1])) return 'literary';
  if (formats.includes(quickStart.formatOptions[0])) return 'short_dynamic';
  return 'negotiable';
}

function postLength(formats: string[]): ProfileInput['averagePostLength'] {
  if (formats.includes(quickStart.formatOptions[1])) return 'paragraphs_3_5';
  if (formats.includes(quickStart.formatOptions[0])) return 'lines_1_3';
  return 'scene_dependent';
}

function activityFrequency(formats: string[]): ProfileInput['activityFrequency'] {
  return formats.includes(quickStart.formatOptions[4]) ? 'daily' : 'flexible';
}

/**
 * Turns the three quick-start answers into a complete, valid questionnaire.
 *
 * Everything the full questionnaire wants but the quick start deliberately does
 * not ask for gets a safe, editable default: the goal is to reach a first match
 * in about a minute, not to finish the interview up front. Every default is
 * something the user can change later in the editor.
 */
export function buildQuickStartProfile(answers: QuickStartAnswers): ProfileInput {
  const formats = answers.formats.slice(0, 6);
  return profileSchema.parse({
    displayName: answers.displayName.trim().slice(0, 32) || ru.miniApp.profile.unknownName,
    ageGroup: answers.ageGroup,
    gender: 'not_specified',
    shortHeadline: answers.hook,
    about: composeAbout(answers.hook, answers.lookingFor, formats),
    roleplayExperience: 'not_specified',
    preferredRole: [ru.miniApp.profile.defaults.preferredRole],
    writingStyle: writingStyle(formats),
    averagePostLength: postLength(formats),
    activityFrequency: activityFrequency(formats),
    timezone: answers.timezone ?? 'UTC+3',
    activeHours: ru.miniApp.profile.defaults.activeHours,
    languages: [quickStart.defaultLanguage],
    fandoms: [quickStart.ownStoriesFandom],
    genres: formats,
    tags: formats,
    settings: '',
    plots: '',
    lookingFor: answers.lookingFor,
    boundaries: quickStart.defaultBoundaries,
    adultTopicsAllowed: false,
    contactRevealPolicy: 'mutual_only',
  });
}
