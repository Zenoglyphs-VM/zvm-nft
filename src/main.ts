import {createApp} from 'vue'

// First: the shared package reads this on its first use.
import './core/configure'
import './style.css'
import App from './App.vue'
import {router} from './router'

createApp(App).use(router).mount('#app')
