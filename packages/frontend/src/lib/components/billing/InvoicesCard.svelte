<script lang="ts">
  import type { BillingInvoice } from '@logtide/shared';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import Spinner from '$lib/components/Spinner.svelte';
  import { formatBillingDate, formatMoney, invoiceStatusBadge, safeExternalUrl } from '$lib/utils/billing';
  import Receipt from '@lucide/svelte/icons/receipt';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Download from '@lucide/svelte/icons/download';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  interface Props {
    invoices: BillingInvoice[];
    loading: boolean;
    /** Plain message when the list could not be loaded. */
    error: string | null;
    onRetry: () => void;
  }

  let { invoices, loading, error, onRetry }: Props = $props();
</script>

<Card>
  <CardHeader class="pb-3">
    <CardTitle class="text-base flex items-center gap-2">
      <Receipt class="h-4 w-4 text-muted-foreground" />
      Invoices
    </CardTitle>
    <CardDescription>Your latest invoices, with a hosted page and a PDF for each</CardDescription>
  </CardHeader>
  <CardContent class="p-0">
    {#if loading}
      <div class="flex justify-center py-10">
        <Spinner />
      </div>
    {:else if error}
      <div class="py-12 text-center">
        <Receipt class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" class="mt-4" onclick={onRetry}>
          <RotateCcw class="mr-1.5 h-4 w-4" />
          Retry
        </Button>
      </div>
    {:else if invoices.length === 0}
      <div class="py-12 text-center">
        <Receipt class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 text-sm text-muted-foreground">No invoices yet.</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead class="hidden sm:table-cell">Number</TableHead>
              <TableHead class="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead class="text-right"><span class="sr-only">Links</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each invoices as invoice (invoice.id)}
              {@const status = invoiceStatusBadge(invoice.status)}
              {@const hosted = safeExternalUrl(invoice.hostedInvoiceUrl)}
              {@const pdf = safeExternalUrl(invoice.invoicePdf)}
              {@const label = invoice.number ?? formatBillingDate(invoice.createdAt)}
              <TableRow>
                <TableCell class="whitespace-nowrap text-sm">{formatBillingDate(invoice.createdAt)}</TableCell>
                <TableCell class="hidden font-mono text-sm sm:table-cell">{invoice.number ?? '-'}</TableCell>
                <TableCell class="text-right font-mono text-sm">{formatMoney(invoice.total, invoice.currency)}</TableCell>
                <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-3 whitespace-nowrap text-sm">
                    {#if hosted}
                      <a
                        href={hosted}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View invoice {label}"
                        class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        View
                        <ExternalLink class="h-3.5 w-3.5" />
                      </a>
                    {/if}
                    {#if pdf}
                      <a
                        href={pdf}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Download PDF of invoice {label}"
                        class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        PDF
                        <Download class="h-3.5 w-3.5" />
                      </a>
                    {/if}
                  </div>
                </TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      </div>
    {/if}
  </CardContent>
</Card>
