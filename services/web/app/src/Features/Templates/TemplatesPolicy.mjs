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

// The owner shares a template as an invitation. A share has a status:
// 'pending' (invited, not yet visible) or 'accepted' (visible/instantiable).
// Returns the share entry for a user, or undefined.
function shareFor(project, userId) {
  if (userId == null || !Array.isArray(project?.templateShares)) return undefined
  return project.templateShares.find(
    s => s?.userId != null && s.userId.toString() === userId.toString()
  )
}

// True only once the user has ACCEPTED the share (pending shares don't count).
function isAcceptedShare(project, userId) {
  return shareFor(project, userId)?.status === 'accepted'
}

// Only the owner may manage a template's share list — admins included. This
// mirrors canMark: sharing exposes the project's content, so it stays with the owner.
function canShare(project, userId) {
  return isOwner(project, userId)
}

// A template can be instantiated by anyone if it's "General", by its owner, or by
// a user who has ACCEPTED a share. This keeps a user from cloning an arbitrary
// (private) project they cannot access — and a merely-pending invite grants nothing.
function canUse(project, userId) {
  return (
    isGeneralTemplate(project) ||
    (Boolean(project?.isTemplate) &&
      (isOwner(project, userId) || isAcceptedShare(project, userId)))
  )
}

// Mongo filter selecting the (non-trashed) templates a given user may see in the
// catalogue: every "General" template, their own, plus templates they ACCEPTED.
// Pending invitations are surfaced via notifications, not the catalogue.
//
// `acceptedTemplateIds` vient de l'index dénormalisé User.sharedTemplates (les
// templateId acceptés). On évite ainsi de scanner templateShares de toute la
// collection : on cible directement par _id. C'est un raccourci de listing —
// l'autorisation réelle reste canUse() sur le projet.
function visibleFilter(userId, acceptedTemplateIds = []) {
  return {
    isTemplate: true,
    $and: [
      { $or: [{ trashed: { $exists: false } }, { trashed: { $size: 0 } }] },
      {
        $or: [
          { templateCategory: GENERAL },
          { owner_ref: userId },
          { _id: { $in: acceptedTemplateIds } },
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
  shareFor,
  isAcceptedShare,
  canShare,
  canUse,
  visibleFilter,
}
