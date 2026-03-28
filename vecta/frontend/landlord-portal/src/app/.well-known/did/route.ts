export async function GET() {
  return Response.json(
    {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:web:vecta.io',
      controller: 'did:web:vecta.io',
      service: [
        {
          id: 'did:web:vecta.io#credential-service',
          type: 'LinkedDomains',
          serviceEndpoint: 'https://verify.vecta.io',
        },
      ],
    },
    { headers: { 'Content-Type': 'application/did+ld+json' } },
  );
}
