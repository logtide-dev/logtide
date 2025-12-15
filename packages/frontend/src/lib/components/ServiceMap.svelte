<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as echarts from "echarts";
  import type { ServiceDependencies } from "$lib/api/traces";
  import { themeStore } from "$lib/stores/theme";
  import { getEChartsTheme, getTooltipStyle } from "$lib/utils/echarts-theme";

  interface Props {
    dependencies: ServiceDependencies;
    width?: string;
    height?: string;
  }

  let { dependencies, width = "100%", height = "400px" }: Props = $props();

  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  // Color palette for services
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
    const nodes = dependencies.nodes.map((node) => ({
      name: node.name,
      id: node.id,
      symbolSize: 30 + (node.callCount / maxCallCount) * 40,
      value: node.callCount,
      itemStyle: {
        color: getServiceColor(node.name),
      },
      label: {
        show: true,
        position: "bottom",
        fontSize: 12,
      },
    }));

    // Find max edge call count for scaling
    const maxEdgeCount = Math.max(
      ...dependencies.edges.map((e) => e.callCount),
      1
    );

    // Build edges with width based on call count
    const edges = dependencies.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      value: edge.callCount,
      lineStyle: {
        width: 1 + (edge.callCount / maxEdgeCount) * 5,
        curveness: 0.2,
      },
      label: {
        show: true,
        formatter: `${edge.callCount}`,
        fontSize: 10,
      },
    }));

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          if (params.dataType === "node") {
            return `<strong>${params.name}</strong><br/>Calls: ${params.value}`;
          } else if (params.dataType === "edge") {
            return `${params.data.source} → ${params.data.target}<br/>Calls: ${params.data.value}`;
          }
          return "";
        },
        ...tooltipStyle
      },
      animationDuration: 1500,
      animationEasingUpdate: "quinticInOut",
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
  }

  // Handle resize
  function handleResize() {
    if (chart) {
      chart.resize();
    }
  }

  let themeUnsubscribe: (() => void) | null = null;

  onMount(() => {
    initChart();
    window.addEventListener("resize", handleResize);

    // Subscribe to theme changes
    themeUnsubscribe = themeStore.subscribe(() => {
      if (chart) {
        initChart();
      }
    });
  });

  onDestroy(() => {
    window.removeEventListener("resize", handleResize);
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
