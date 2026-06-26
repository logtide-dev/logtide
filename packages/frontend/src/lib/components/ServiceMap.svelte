<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as echarts from "echarts";
  import type { ServiceDependencies, EnrichedServiceDependencies } from "$lib/api/traces";
  import { themeStore } from "$lib/stores/theme";
  import { getEChartsTheme, getTooltipStyle } from "$lib/utils/echarts-theme";
  import { escapeHtml } from "$lib/utils/html";

  interface Props {
    dependencies: ServiceDependencies | EnrichedServiceDependencies;
    width?: string;
    height?: string;
    onNodeClick?: (nodeName: string) => void;
  }

  let { dependencies, width = "100%", height = "400px", onNodeClick }: Props = $props();

  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  // Color palette for services (fallback for non-enriched nodes)
  const colors = [
    "#5470c6",
    "#91cc75",
    "#fac858",
    "#ee6666",
    "#73c0de",
    "#3ba272",
    "#fc8452",
    "#9a60b4",
    "#ea7ccc",
  ];

  function getServiceColor(serviceName: string): string {
    const hash = serviceName.split("").reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc);
    }, 0);
    return colors[Math.abs(hash) % colors.length];
  }

  function getNodeColor(node: { name: string; errorRate?: number }): string {
    if ('errorRate' in node && node.errorRate !== undefined) {
      if (node.errorRate >= 0.1) return '#ef4444';
      if (node.errorRate >= 0.01) return '#f59e0b';
      return '#10b981';
    }
    return getServiceColor(node.name);
  }

  function isEnrichedNode(node: unknown): node is { errorRate: number; avgLatencyMs: number; totalCalls: number } {
    return typeof node === 'object' && node !== null && 'errorRate' in node;
  }

  function isEnrichedEdge(edge: unknown): edge is { type: string } {
    return typeof edge === 'object' && edge !== null && 'type' in edge;
  }

  function formatLatency(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function buildChartOptions() {
    const theme = getEChartsTheme();
    const tooltipStyle = getTooltipStyle();

    if (!dependencies || dependencies.nodes.length === 0) {
      return {
        title: {
          text: "No service dependencies found",
          left: "center",
          top: "middle",
          textStyle: {
            color: theme.textColor,
            fontSize: 14,
          },
        },
      };
    }

    // Find max call count for scaling
    const maxCallCount = Math.max(
      ...dependencies.nodes.map((n) => n.callCount),
      1
    );

    // Build nodes with sizes based on call count
    const nodes = dependencies.nodes.map((node) => {
      const hasErrors = isEnrichedNode(node) && node.errorRate >= 0.1;
      return {
        name: node.name,
        id: node.id,
        symbolSize: 30 + (node.callCount / maxCallCount) * 40,
        value: node.callCount,
        itemStyle: {
          color: getNodeColor(node),
          borderColor: hasErrors ? '#991b1b' : undefined,
          borderWidth: hasErrors ? 2 : 0,
        },
        label: {
          show: true,
          position: "bottom" as const,
          fontSize: 12,
        },
      };
    });

    // Find max edge call count for scaling
    const maxEdgeCount = Math.max(
      ...dependencies.edges.map((e) => e.callCount),
      1
    );

    // Build edges with width based on call count
    const edges = dependencies.edges.map((edge) => {
      const isLogCorrelation = isEnrichedEdge(edge) && edge.type === 'log_correlation';
      return {
        source: edge.source,
        target: edge.target,
        value: edge.callCount,
        lineStyle: {
          width: 1 + (edge.callCount / maxEdgeCount) * 5,
          curveness: 0.2,
          type: isLogCorrelation ? 'dashed' as const : 'solid' as const,
          opacity: isLogCorrelation ? 0.4 : 0.6,
        },
        label: {
          show: true,
          formatter: `${edge.callCount}`,
          fontSize: 10,
        },
      };
    });

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          if (params.dataType === "node") {
            const node = dependencies.nodes.find((n) => n.name === params.name);
            let html = `<strong>${escapeHtml(params.name)}</strong><br/>Calls: ${params.value}`;
            if (node && isEnrichedNode(node)) {
              html += `<br/>Error rate: ${(node.errorRate * 100).toFixed(1)}%`;
              html += `<br/>Avg latency: ${formatLatency(node.avgLatencyMs)}`;
            }
            return html;
          } else if (params.dataType === "edge") {
            const edge = dependencies.edges.find(
              (e) => e.source === params.data.source && e.target === params.data.target
            );
            let html = `${escapeHtml(params.data.source)} → ${escapeHtml(params.data.target)}<br/>Calls: ${params.data.value}`;
            if (edge && isEnrichedEdge(edge) && edge.type === 'log_correlation') {
              html += `<br/><em>(log correlation)</em>`;
            }
            return html;
          }
          return "";
        },
        ...tooltipStyle
      },
      animationDuration: 1500,
      animationEasingUpdate: "quinticInOut" as const,
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          data: nodes,
          links: edges,
          categories: [],
          force: {
            repulsion: 300,
            edgeLength: [100, 200],
            gravity: 0.1,
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: {
              width: 8,
            },
          },
          edgeSymbol: ["none", "arrow"],
          edgeSymbolSize: [0, 10],
          lineStyle: {
            color: "source",
            opacity: 0.6,
          },
        },
      ],
    };
  }

  function initChart() {
    if (!chartContainer) return;

    if (chart) {
      chart.dispose();
    }

    chart = echarts.init(chartContainer);
    const options = buildChartOptions();
    chart.setOption(options);

    if (onNodeClick) {
      chart.on('click', 'series.graph', (params: any) => {
        if (params.dataType === 'node') {
          onNodeClick(params.name);
        }
      });
    }
  }

  let themeUnsubscribe: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    initChart();

    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartContainer);

    // Subscribe to theme changes
    themeUnsubscribe = themeStore.subscribe(() => {
      if (chart) {
        initChart();
      }
    });
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (themeUnsubscribe) {
      themeUnsubscribe();
    }
    if (chart) {
      chart.dispose();
      chart = null;
    }
  });

  // Re-initialize when dependencies change
  $effect(() => {
    if (dependencies && chartContainer) {
      initChart();
    }
  });
</script>

<div
  bind:this={chartContainer}
  style="width: {width}; height: {height};"
  class="service-map"
></div>

<style>
  .service-map {
    min-height: 300px;
  }
</style>
