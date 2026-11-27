import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import homeRouter from '@/router/home';
import otherRouter from '@/router/other';
import { useSettingsStore } from '@/store/modules/settings';
import { isElectron } from '@/utils';

function buildInitialMenus() {
  const libraryRoute = otherRouter.find((item) => item.path === '/library');
  if (!libraryRoute) return homeRouter;

  // Insert unified "我的音乐" (/library) right before /user (or /set) so it appears
  // cleanly in both desktop sidebar and the 4-tab mobile bottom dock.
  const userIdx = homeRouter.findIndex((item) => item.path === '/user');
  if (userIdx === -1) return [...homeRouter, libraryRoute];
  return [
    ...homeRouter.slice(0, userIdx),
    libraryRoute,
    ...homeRouter.slice(userIdx)
  ];
}

export const useMenuStore = defineStore('menu', () => {
  const allMenus = ref(buildInitialMenus());
  const settingsStore = useSettingsStore();

  const menus = computed(() => {
    return allMenus.value.filter((item) => {
      if (item.meta?.electronOnly && !isElectron) {
        return false;
      }
      if (item.meta?.hideInSidebar) {
        return false;
      }
      if (settingsStore.isMobile) {
        return item.meta?.isMobile !== false;
      }
      return true;
    });
  });

  const setMenus = (newMenus: any[]) => {
    allMenus.value = newMenus;
  };

  return {
    menus,
    setMenus
  };
});
