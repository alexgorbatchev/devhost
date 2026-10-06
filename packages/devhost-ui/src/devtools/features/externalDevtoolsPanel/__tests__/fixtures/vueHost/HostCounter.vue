<script setup>
import { ref } from "vue";
defineProps({ project: String });
const count = ref(0);
</script>
<template>
  <h2>Vue {{ project }} count {{ count }}</h2>
  <button @click="count++">Increment Vue {{ project }}</button>
</template>
