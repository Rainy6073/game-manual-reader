// Element ids used to link the Focused View with its Contents entries.
export const DESCRIPTION_ID = 'focus-description'
export const ruleAnchor = (id: string) => `focus-rule-${id}`
export const sectionAnchor = (title: string) => `focus-section-${title.replace(/\W+/g, '-')}`
