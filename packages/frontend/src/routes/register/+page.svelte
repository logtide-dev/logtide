<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { toastStore } from '$lib/stores/toast';
  import { authAPI } from '$lib/api/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import Footer from '$lib/components/Footer.svelte';

  let name = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let error = '';
  let loading = false;
  let nameError = '';
  let emailError = '';
  let passwordError = '';
  let confirmPasswordError = '';

  function validateForm(): boolean {
    nameError = '';
    emailError = '';
    passwordError = '';
    confirmPasswordError = '';
    let isValid = true;

    if (!name.trim()) {
      nameError = 'Name is required';
      isValid = false;
    }

    if (!email) {
      emailError = 'Email is required';
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError = 'Please enter a valid email';
      isValid = false;
    }

    if (!password) {
      passwordError = 'Password is required';
      isValid = false;
    } else if (password.length < 8) {
      passwordError = 'Password must be at least 8 characters';
      isValid = false;
    }

    if (!confirmPassword) {
      confirmPasswordError = 'Please confirm your password';
      isValid = false;
    } else if (password !== confirmPassword) {
      confirmPasswordError = 'Passwords do not match';
      isValid = false;
    }

    return isValid;
  }

  async function handleSubmit() {
    if (!validateForm()) {
      error = 'Please fix the errors below';
      return;
    }

    loading = true;
    error = '';

    try {
      const response = await authAPI.register({ name, email, password });
      authStore.setAuth(response.user, response.session.token);
      toastStore.success('Account created successfully!');

      // New users don't have organizations yet -> redirect to onboarding tutorial
      goto('/onboarding');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Registration failed';
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Sign Up - LogWard</title>
</svelte:head>

<div class="min-h-screen flex flex-col bg-background">
  <div class="flex-1 flex items-center justify-center p-4">
    <Card class="w-full max-w-md">
        <CardHeader class="flex flex-row justify-center items-center gap-4">
            <img src="/small_logo/white.svg" alt="LogWard Logo" class="h-16 w-auto" />
            <div>
                <CardTitle class="text-2xl">Create an account</CardTitle>
                <CardDescription>Get started with LogWard</CardDescription>
            </div>
        </CardHeader>

      <form on:submit|preventDefault={handleSubmit}>
        <CardContent class="space-y-4">
          {#if error}
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          {/if}

          <div class="space-y-2">
            <Label for="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              bind:value={name}
              disabled={loading}
              required
              class={nameError ? 'border-destructive' : ''}
            />
            {#if nameError}
              <p class="text-sm text-destructive">{nameError}</p>
            {/if}
          </div>

          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              bind:value={email}
              disabled={loading}
              required
              class={emailError ? 'border-destructive' : ''}
            />
            {#if emailError}
              <p class="text-sm text-destructive">{emailError}</p>
            {/if}
          </div>

          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              bind:value={password}
              disabled={loading}
              required
              class={passwordError ? 'border-destructive' : ''}
            />
            {#if passwordError}
              <p class="text-sm text-destructive">{passwordError}</p>
            {/if}
          </div>

          <div class="space-y-2">
            <Label for="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              bind:value={confirmPassword}
              disabled={loading}
              required
              class={confirmPasswordError ? 'border-destructive' : ''}
            />
            {#if confirmPasswordError}
              <p class="text-sm text-destructive">{confirmPasswordError}</p>
            {/if}
          </div>
        </CardContent>

        <CardFooter class="flex flex-col gap-4">
          <Button type="submit" class="w-full gap-2" disabled={loading}>
            {#if loading}
              <Spinner size="sm" />
              Creating account...
            {:else}
              Create account
            {/if}
          </Button>

          <p class="text-sm text-muted-foreground text-center">
            Already have an account?
            <a href="/login" class="text-primary hover:underline">Sign in</a>
          </p>
        </CardFooter>
      </form>
    </Card>
  </div>

  <Footer />
</div>
