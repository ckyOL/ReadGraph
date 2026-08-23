import { Outlet, createRootRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BarChart3Icon,
  LayoutDashboardIcon,
  LibraryIcon,
  SettingsIcon,
  TimelineIcon,
  UploadIcon,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

import { ThemeProvider } from '@/hooks/use-theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import { db } from '@/db/db-instance'
import { Button } from '@/components/ui/button'
const navItems = [
  { to: '/', key: 'dashboard' as const, Icon: LayoutDashboardIcon },
  { to: '/library', key: 'library' as const, Icon: LibraryIcon },
  { to: '/timeline', key: 'timeline' as const, Icon: TimelineIcon },
  { to: '/profile', key: 'profile' as const, Icon: BarChart3Icon },
  { to: '/settings', key: 'settings' as const, Icon: SettingsIcon },
]

export const Route = createRootRoute({
  component: RootLayout,
})

function SidebarNav() {
  const { t } = useTranslation('nav')
  const { isMobile, setOpenMobile } = useSidebar()
  // 待完善徽标：needsReview=true 的 Book 数（book-editing 规格 §5.3，响应式计数，挂书库入口）。
  // 不建索引（IDB 键类型不含 boolean，真实浏览器布尔索引失效，H1 回归）→ 全量内存过滤。
  const reviewCount = useLiveQuery(
    async () => (await db.books.toArray()).filter((b) => b.needsReview).length,
    [],
  )
  return (
    <SidebarContent className="px-2">
      <SidebarMenu>
        {navItems.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              asChild
              onClick={isMobile ? () => setOpenMobile(false) : undefined}
            >
              <Link to={item.to}>
                <item.Icon />
                <span>{t(item.key)}</span>
              </Link>
            </SidebarMenuButton>
            {item.key === 'library' && (reviewCount ?? 0) > 0 && (
              <SidebarMenuBadge>{reviewCount}</SidebarMenuBadge>
            )}
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
      <TooltipProvider>
        <SidebarProvider>
          <Sidebar>
            <SidebarHeader className="gap-2 border-b border-sidebar-border px-4 py-4">
              <div className="flex items-center gap-2">
                <span aria-hidden className="flex size-4 shrink-0 items-center justify-center gap-px bg-primary">
                  <span className="h-2.5 w-px bg-primary-foreground" />
                  <span className="h-2.5 w-px bg-primary-foreground" />
                  <span className="h-2.5 w-px bg-primary-foreground" />
                </span>
                <span className="font-display text-lg font-semibold tracking-[0.04em]">
                  {t('app.name', { ns: 'common' })}
                </span>
              </div>
              <p className="text-xs text-sidebar-foreground/60">
                {t('app.tagline', { ns: 'common' })}
              </p>
            </SidebarHeader>
            <SidebarNav />
            <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
              <Button asChild variant="outline" className="h-11 w-full justify-start gap-2 md:h-9">
                <Link to="/import">
                  <UploadIcon />
                  <span>{t('import')}</span>
                </Link>
              </Button>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <SidebarTrigger className="-ml-1" />
            </div>
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
