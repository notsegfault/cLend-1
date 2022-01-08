const { mainnet } = require("./config");
const { impersonate } = require("./utilities");
const { expectRevert } = require("@openzeppelin/test-helpers");
const { expect } = require("hardhat");
const IERC20 = artifacts.require(
  "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20"
);
const ProxyAdmin = artifacts.require("MockProxyAdmin");
const CoreVault = artifacts.require("CoreVault");
const CoreDAO = artifacts.require("CoreDAO");
const CoreDAOTreasury = artifacts.require("CoreDAOTreasury");

const ADMIN_PROXY = "0x9cb1eEcCd165090a4a091209E8c3a353954B1f0f";
const DEPLOYER = "0x5A16552f59ea34E44ec81E58b3817833E9fD5436";
const VAULT = "0xC5cacb708425961594B63eC171f4df27a9c0d8c9";

// user with vouchers in the 3 pools
const user = "0x1cb3fae03e5f73df7cbbc75e1d236dc459c72436";

describe("migrations / coredao vault migration", async () => {
  let vault;
  let coredao;
  let treasury;
  let snapshot;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl:
              "https://eth-mainnet.alchemyapi.io/v2/TsLEJAhX87icgMO7ZVyPcpeEgpFEo96O",
            blockNumber: 13919761,
          },
        },
      ],
    });

    await impersonate(DEPLOYER);
    await impersonate(user);

    const adminProxy = await ProxyAdmin.at(ADMIN_PROXY);

    treasury = await CoreDAOTreasury.new();
    vault = await CoreVault.at(VAULT);
    coredao = await CoreDAO.new(0, treasury.address);
    await treasury.initialize(coredao.address);

    const impl = await CoreVault.new(coredao.address, treasury.address);
    await adminProxy.upgrade(VAULT, impl.address, { from: DEPLOYER });

    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshot]);
    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  it("should fail to migrate as the coredao pool does not exist", async () => {
    await expectRevert(vault.migrateVouchers(), "WRONG_POOL_COUNT");
  });

  it("should fail to migrate as the coredao is using the wrong token", async () => {
    await vault.add(
      100,
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      true,
      true,
      { from: DEPLOYER }
    );
    await expectRevert(vault.migrateVouchers(), "WRONG_TOKEN");
  });

  it("should fail to migrate as there is nothing to migrate", async () => {
    await vault.add(100, coredao.address, true, true, { from: DEPLOYER });
    await impersonate("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    await expectRevert(
      vault.migrateVouchers({
        from: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      }),
      "NOTHING_TO_WRAP"
    );
  });

  it("should migrate the user pool to coredao pool", async () => {
    await vault.add(100, coredao.address, true, true, { from: DEPLOYER });

    const core = await IERC20.at(mainnet.addresses.core);
    const coreBalanceBefore = await core.balanceOf(user);

    // amount, rewardDebt
    const balancesBefore = [
      await vault.userInfo(0, user),
      await vault.userInfo(1, user),
      await vault.userInfo(2, user),
      await vault.userInfo(3, user),
    ];

    expect(balancesBefore[0].amount).to.be.bignumber.gt("0");
    expect(balancesBefore[1].amount).to.be.bignumber.gt("0");
    expect(balancesBefore[2].amount).to.be.bignumber.gt("0");
    expect(balancesBefore[0].rewardDebt).to.be.bignumber.gt("0");
    expect(balancesBefore[1].rewardDebt).to.be.bignumber.gt("0");
    expect(balancesBefore[2].rewardDebt).to.be.bignumber.gt("0");

    expect(balancesBefore[3].amount).to.be.bignumber.equal("0");
    expect(balancesBefore[3].rewardDebt).to.be.bignumber.equal("0");

    await vault.migrateVouchers({ from: user });

    const coreBalanceAfter = await core.balanceOf(user);
    const balancesAfter = [
      await vault.userInfo(0, user),
      await vault.userInfo(1, user),
      await vault.userInfo(2, user),
      await vault.userInfo(3, user),
    ];

    expect(coreBalanceAfter).to.be.bignumber.gt(coreBalanceBefore);
    expect(balancesAfter[0].amount).to.be.bignumber.equal("0");
    expect(balancesAfter[1].amount).to.be.bignumber.equal("0");
    expect(balancesAfter[2].amount).to.be.bignumber.equal("0");
    expect(balancesAfter[0].rewardDebt).to.be.bignumber.equal("0");
    expect(balancesAfter[1].rewardDebt).to.be.bignumber.equal("0");
    expect(balancesAfter[2].rewardDebt).to.be.bignumber.equal("0");

    expect(balancesAfter[3].amount).to.be.bignumber.gt("0");
    expect(balancesAfter[3].rewardDebt).to.be.bignumber.equal("0");
  });
});
