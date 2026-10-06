import js from '@eslint/js'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // backend/_figma — локальные скрипты выгрузки макета, в git не попадают.
  globalIgnores(['dist', 'backend/dist', 'backend/_figma', '.next', 'next-env.d.ts']),
  js.configs.recommended,
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react из eslint-config-next определяет версию React через
    // context.getFilename(), которого в ESLint 10 больше нет, и падает.
    // С явной версией до автоопределения дело не доходит.
    settings: { react: { version: '19.2' } },
    rules: {
      // Картинки — карты трасс, загруженные через админку и отдаваемые
      // бэкендом. next/image гонял бы их через оптимизатор на том же VM
      // с 2 ГБ памяти; выигрыша для пары картинок на экран нет.
      '@next/next/no-img-element': 'off',
    },
  },
])
