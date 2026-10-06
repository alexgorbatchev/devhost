<script setup>
import { ref } from "vue";
import HostCounter from "./HostCounter.vue";
const isMounted = ref(true);
const project = new URL(location.href).searchParams.get("project") ?? "A";
</script>
<template>
  <h1>Native Vue host {{ project }}</h1>
  <button @click="isMounted = !isMounted">Toggle counter mount</button>
  <HostCounter v-if="isMounted" :project="project" />
</template>
