export const TROUBLESHOOTING_TIPS: { title: string; body: string }[] = [
  {
    title: 'Wrong API key',
    body: 'Check that the key was copied in full and belongs to this project. A rejected key shows up as a 401 in your application logs.',
  },
  {
    title: 'Wrong URL, port or TLS setting',
    body: 'The URL in your snippet must be reachable from where your application runs. Match http or https, and the port, to how LogTide is exposed.',
  },
  {
    title: 'Clock skew',
    body: 'Events with timestamps far from the server time can be rejected or stored out of range. Make sure the clock of your host is in sync.',
  },
  {
    title: 'Firewall or proxy',
    body: 'Outbound traffic from your application to LogTide may be blocked. Test with the cURL snippet from the same machine.',
  },
];
