import { Outlet, createRootRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

import { ThemeProvider } from '@/hooks/use-theme'
const navItems = [
  { to: '/', key: 'dashboard' as const },
  { to: '/library', key: 'library' as const },
  { to: '/timeline', key: 'timeline' as const },
  { to: '/import', key: 'import' as const },
  { to: '/profile', key: 'profile' as const },
  { to: '/settings', key: 'settings' as const },
]

export const Route = createRootRoute({
  component: RootLayout,
})

function SidebarNav() {
  const { t } = useTranslation('nav')
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarContent>
      <SidebarMenu>
        {navItems.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              asChild
              onClick={isMobile ? () => setOpenMobile(false) : undefined}
            >
              <Link to={item.to}>{t(item.key)}</Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarContent>
  )
}

function RootLayout() {
  const { t } = useTranslation('nav')
  return (
    <ThemeProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <span className="px-2 text-lg font-bold">{t('app.name', { ns: 'common' })}</span>
          </SidebarHeader>
          <SidebarNav />
        </Sidebar>
        <SidebarInset>
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger className="-ml-1" />
          </div>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  )
}
