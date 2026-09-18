import { Menu, shell } from 'electron';
import { t } from './i18n';

export const FILLFORGE_REPOSITORY_URL = 'https://github.com/lihaozhe013/FillForge';
export const USER_GUIDE_URL = `${FILLFORGE_REPOSITORY_URL}/blob/main/docs/USER_GUIDE.md`;
export const SPECIFICATION_URL = `${FILLFORGE_REPOSITORY_URL}/blob/main/SPEC.md`;

export function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.userGuide'),
          click: () => {
            void shell.openExternal(USER_GUIDE_URL);
          }
        },
        {
          label: t('menu.projectSpecification'),
          click: () => {
            void shell.openExternal(SPECIFICATION_URL);
          }
        },
        { type: 'separator' },
        {
          label: t('menu.onGithub'),
          click: () => {
            void shell.openExternal(FILLFORGE_REPOSITORY_URL);
          }
        }
      ]
    },
    ...(process.platform === 'darwin' ? [{ role: 'windowMenu' as const }] : [])
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
