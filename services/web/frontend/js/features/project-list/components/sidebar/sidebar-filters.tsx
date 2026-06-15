import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Filter,
  useProjectListContext,
} from '../../context/project-list-context'
import TagsList from './tags-list'
import ProjectsFilterMenu from '../projects-filter-menu'
import getMeta from '../../../../utils/meta'
import { getJSON } from '../../../../infrastructure/fetch-json'

type SidebarFilterProps = {
  filter: Filter
  text: React.ReactNode
}

export function SidebarFilter({ filter, text }: SidebarFilterProps) {
  const { selectFilter } = useProjectListContext()

  return (
    <ProjectsFilterMenu filter={filter}>
      {isActive => (
        <li className={isActive ? 'active' : ''}>
          <button type="button" onClick={() => selectFilter(filter)}>
            {text}
          </button>
        </li>
      )}
    </ProjectsFilterMenu>
  )
}

type GeneralTemplate = {
  id: string
  name: string
  description?: string
}

function GeneralTemplatesSection() {
  const [templates, setTemplates] = useState<GeneralTemplate[]>([])

  useEffect(() => {
    getJSON('/project/templates')
      .then((data: { templates: GeneralTemplate[] }) => {
        setTemplates(data.templates ?? [])
      })
      .catch(() => {})
  }, [])

  if (templates.length === 0) return null

  return (
    <>
      <li aria-hidden="true">
        <hr />
      </li>
      <li className="sidebar-section-header">
        <span>General templates</span>
      </li>
      {templates.map(tmpl => (
        <li key={tmpl.id}>
          <a href={`/project/${tmpl.id}`} title={tmpl.description}>
            {tmpl.name}
          </a>
        </li>
      ))}
    </>
  )
}

export default function SidebarFilters() {
  const { t } = useTranslation()
  const isAdmin = getMeta('ol-user')?.isAdmin
  return (
    <ul className="list-unstyled project-list-filters">
      <SidebarFilter filter="all" text={t('all_projects')} />
      <SidebarFilter filter="owned" text={t('your_projects')} />
      <SidebarFilter filter="shared" text={t('shared_with_you')} />
      <SidebarFilter filter="archived" text={t('archived_projects')} />
      <SidebarFilter filter="trashed" text={t('trashed_projects')} />
      <li aria-hidden="true">
        <hr />
      </li>
      <TagsList />
      {isAdmin && <GeneralTemplatesSection />}
    </ul>
  )
}
