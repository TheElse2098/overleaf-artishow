// Single source of truth for the templates access rules.
//
// These rules used to be duplicated across TemplatesController (mark / remove /
// list) and ProjectController.newProject (instantiate). Keeping them here, as
// pure helpers (no DB, no session), means the policy can only ever drift in one
// place — and can be unit-tested in isolation.
//
// A "template" is a regular project flagged `isTemplate: true`, with a
// `templateCategory` of either 'General' (shared with everyone) or 'Personnel'
// (visible only to its owner).

const GENERAL = 'General'
const PERSONNEL = 'Personnel'

function isOwner(project, userId) {
  return (
    project?.owner_ref != null &&
    userId != null &&
    project.owner_ref.toString() === userId.toString()
  )
}

// A shared template that any user may see and instantiate.
function isGeneralTemplate(project) {
  return Boolean(project?.isTemplate) && project.templateCategory === GENERAL
}

// The category a project should receive when (un)marked as a template. Only an
// admin may publish a shared "General" template; everyone else (and admins who
// leave the box unchecked) get a "Personnel" template.
function categoryForMarking({ isAdmin, isGeneral }) {
  return isAdmin && isGeneral ? GENERAL : PERSONNEL
}

// Only the owner may (un)mark or edit a project's template status — admins
// included. This stops anyone from publishing another user's private project as
// a template and exposing its content.
function canMark(project, userId) {
  return isOwner(project, userId)
}

// The owner can always remove their own template; an admin can additionally
// remove a shared "General" template — but never someone else's Personnel one.
function canRemove(project, userId, isAdmin) {
  return isOwner(project, userId) || (Boolean(isAdmin) && isGeneralTemplate(project))
}

// The owner shares a template with a list of users (templateSharedWith). They may
// see and instantiate it, but never edit or re-share it.
function isSharedWith(project, userId) {
  if (userId == null || !Array.isArray(project?.templateSharedWith)) return false
  return project.templateSharedWith.some(
    id => id != null && id.toString() === userId.toString()
  )
}

// Only the owner may manage a template's share list — admins included. This
// mirrors canMark: sharing exposes the project's content, so it stays with the owner.
function canShare(project, userId) {
  return isOwner(project, userId)
}

// A template can be instantiated by anyone if it's "General", by its owner, or by
// a user it was shared with. This keeps a user from cloning an arbitrary (private)
// project they cannot access.
function canUse(project, userId) {
  return (
    isGeneralTemplate(project) ||
    (Boolean(project?.isTemplate) &&
      (isOwner(project, userId) || isSharedWith(project, userId)))
  )
}

// Mongo filter selecting the (non-trashed) templates a given user may see:
// every "General" template, their own templates, plus templates shared with them.
function visibleFilter(userId) {
  return {
    isTemplate: true,
    $and: [
      { $or: [{ trashed: { $exists: false } }, { trashed: { $size: 0 } }] },
      {
        $or: [
          { templateCategory: GENERAL },
          { owner_ref: userId },
          { templateSharedWith: userId },
        ],
      },
    ],
  }
}

export default {
  GENERAL,
  PERSONNEL,
  isOwner,
  isGeneralTemplate,
  categoryForMarking,
  canMark,
  canRemove,
  isSharedWith,
  canShare,
  canUse,
  visibleFilter,
}
