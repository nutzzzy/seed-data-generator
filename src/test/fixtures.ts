import { EPOCH } from '../lib/defaults';
import type { Standard, Template } from '../lib/types';

// A second, unrelated standard and template, used by tests to prove that the engine is not tied to Seed Data.

export const exampleStandard: Standard = {
  id: 'std_example',
  name: 'Acceptance criteria (Given/When/Then)',
  description: 'Testable acceptance criteria written from the user’s point of view.',
  rules: [
    'Each row describes exactly one testable behaviour.',
    'Given / When / Then are full sentences in the present tense.',
    'Do not mention implementation details (database, API names, UI frameworks).',
    'Priority comes from the source; never guess it.',
  ].join('\n'),
  requiredContent: 'Every scenario mentioned in the source must have a row, including error cases.',
  validationCriteria: 'IDs are unique and follow AC-<number>. Priority is High, Medium or Low.',
  examples:
    'AC-1 | Successful login | Given a registered user is on the login page | When they submit a valid email and password | Then they see their dashboard | High',
  updatedAt: EPOCH,
};

export const exampleTemplate: Template = {
  id: 'tpl_example',
  name: 'Acceptance criteria table',
  columns: [
    {
      id: 'col_ex_id',
      name: 'ID',
      description: 'Unique identifier',
      required: true,
      expected: 'AC-1, AC-2, … in order',
      allowedValues: '',
      pattern: '^AC-\\d+$',
      maxLength: null,
      unique: true,
      forbidden: '',
    },
    {
      id: 'col_ex_scenario',
      name: 'Scenario',
      description: 'Short name of the behaviour',
      required: true,
      expected: 'At most 8 words',
      allowedValues: '',
      pattern: '',
      maxLength: 80,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_given',
      name: 'Given',
      description: 'Starting situation',
      required: true,
      expected: 'Starts with "Given"',
      allowedValues: '',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_when',
      name: 'When',
      description: 'User action or event',
      required: true,
      expected: 'Starts with "When"',
      allowedValues: '',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_then',
      name: 'Then',
      description: 'Observable result',
      required: true,
      expected: 'Starts with "Then"',
      allowedValues: '',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_priority',
      name: 'Priority',
      description: 'Business priority from the source',
      required: false,
      expected: '',
      allowedValues: 'High, Medium, Low',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
  ],
  updatedAt: EPOCH,
};

export const exampleInput = `Password reset feature

- A user who forgot their password can request a reset link from the login page by entering their email. (High)
- If the email is not registered, show the same confirmation message so accounts can't be discovered.
- The reset link expires after 30 minutes. Opening an expired link shows an error and offers to send a new link.
- The new password must have at least 12 characters. Priority: Medium`;

