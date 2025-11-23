export const autoExpireSessions = async () => {
  const now = new Date();

  const expiredSubs = await prisma.subscription.findMany({
    where: { endTime: { lt: now }, status: "ACTIVE" },
  });

  for (const sub of expiredSubs) {
    const activeSessions = await prisma.routerSession.findMany({
      where: { userId: sub.userId, logoutTime: null },
      include: { user: true },
    });

    for (const s of activeSessions) {
      await RouterSessionManager.end({ macAddress: s.macAddress });
      console.log(`Session auto-ended for user ${sub.userId}`);
    }

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "EXPIRED" },
    });
  }
};
